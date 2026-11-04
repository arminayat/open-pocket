import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import type { DownloadTarget, LocalRecording, Recording, Transport } from '@/lib/pocket/types';
import { parseManifest } from '@/lib/icloud/archive';
import type { RecordingManifest } from '@/lib/icloud/types';
import { createIndexPublicationQueue, indexRecording } from './library-index';
import { publishIndexSnapshot, readIndexSnapshot, type IndexStorage } from './index-snapshots';

const directory = () => new Directory(Paths.document, 'recordings');
const publishLibrary = createIndexPublicationQueue();
const indexStorage = (folder: Directory): IndexStorage => ({
  list: () => folder.list().filter((entry): entry is File => entry instanceof File).map(entry => entry.name),
  read: name => new File(folder, name).text(),
  write: (name, contents) => new File(folder, name).write(contents),
  move: (from, to) => new File(folder, from).move(new File(folder, to)),
  remove: name => { const file = new File(folder, name); if (file.exists) file.delete(); },
});

export async function loadLibrary(): Promise<LocalRecording[]> {
  const folder = directory();
  folder.create({ idempotent: true, intermediates: true });
  for (const entry of folder.list()) {
    if (entry instanceof File && entry.name.endsWith('.part')) entry.delete();
  }
  try {
    const entries = await readIndexSnapshot(indexStorage(folder));
    return entries.flatMap(item => {
      // Store only leaf names; iOS can change the app container URL after an update.
      const file = new File(folder, item.filename);
      const { filename: _filename, ...metadata } = item;
      return file.exists && file.size === item.bytes ? [{ ...metadata, uri: file.uri }] : [];
    });
  } catch { return []; }
}

export function createDownloadTarget(recording: Recording, transport: Transport): DownloadTarget {
  if (!/^[\w-]{1,80}$/.test(recording.date) || !/^[\w-]{1,80}$/.test(recording.timestamp)) {
    throw new Error('The recorder returned an invalid recording filename.');
  }
  const folder = directory();
  folder.create({ idempotent: true, intermediates: true });
  const stem = `${recording.date}_${recording.timestamp}_${transport}_${Date.now()}`;
  const part = new File(folder, `${stem}.part`);
  part.create();
  let handle: FileHandle | null = null;
  let phase: 'writing' | 'committing' | 'complete' | 'aborted' = 'writing';
  const close = () => { try { handle?.close(); } finally { handle = null; } };
  return {
    uri: part.uri,
    write(bytes) {
      if (phase !== 'writing') throw new Error('The download has already ended.');
      handle ??= part.open();
      handle.writeBytes(bytes);
    },
    async commit(expectedBytes) {
      if (phase !== 'writing') throw new Error('The download has already ended.');
      phase = 'committing';
      close();
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || part.size !== expectedBytes) {
        throw new Error('The downloaded recording is incomplete. Try downloading it again.');
      }
      // Read the index without startup cleanup: another .part is never removed during a transfer.
      return publishLibrary(async () => {
        const storage = indexStorage(folder);
        const previous = await readIndexSnapshot(storage);
        // No await after this check: publication is the terminal completion boundary.
        if ((phase as string) === 'aborted') throw new Error('Download cancelled.');
        const file = new File(folder, `${stem}.mp3`);
        part.move(file);
        const local: LocalRecording = { ...recording, uri: file.uri, bytes: expectedBytes, transport, downloadedAt: new Date().toISOString() };
        const replaced = previous.filter(item => item.id === recording.id && item.transport === transport);
        const next = [indexRecording(local, file.name), ...previous.filter(item => item.id !== recording.id || item.transport !== transport)];
        try { publishIndexSnapshot(storage, next); }
        catch (error) { file.delete(); throw error; }
        phase = 'complete';
        for (const old of replaced) {
          try { const oldFile = new File(folder, old.filename); if (oldFile.exists) oldFile.delete(); } catch { /* orphan is harmless */ }
        }
        return local;
      });
    },
    abort() {
      if (phase === 'complete' || phase === 'aborted') return;
      phase = 'aborted';
      close();
      if (part.exists) part.delete();
    },
  };
}

/** The native importer verifies SHA-256 before returning this fixed local audio path. */
export function adoptCloudRecording(value: RecordingManifest, uri: string): Promise<LocalRecording> {
  return publishLibrary(async () => {
    const manifest = parseManifest(JSON.stringify(value));
    const folder = directory();
    const file = new File(folder, `icloud_${manifest.sha256}.mp3`);
    if (uri !== file.uri || !file.exists || file.size !== manifest.bytes) {
      throw new Error('The downloaded iCloud audio is missing or has changed. Try syncing again.');
    }
    const storage = indexStorage(folder);
    const previous = await readIndexSnapshot(storage);
    const existing = previous.find(item => item.filename === file.name && item.id === manifest.id);
    if (existing) {
      if (existing.bytes !== manifest.bytes || existing.date !== manifest.date || existing.timestamp !== manifest.timestamp
        || existing.durationSeconds !== manifest.durationSeconds) throw new Error('The saved recording conflicts with its iCloud metadata.');
      const { filename: _filename, ...metadata } = existing;
      return { ...metadata, uri: file.uri };
    }
    const local: LocalRecording = {
      id: manifest.id, date: manifest.date, timestamp: manifest.timestamp, durationSeconds: manifest.durationSeconds,
      uri: file.uri, bytes: manifest.bytes, transport: 'icloud', downloadedAt: new Date().toISOString(),
    };
    // Keep the verified file on a failed publication so the next sync can adopt it without another download.
    publishIndexSnapshot(storage, [indexRecording(local, file.name), ...previous]);
    return local;
  });
}
