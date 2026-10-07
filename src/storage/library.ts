import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import type { DownloadTarget, LocalRecording, Recording, Transport } from '@/lib/pocket/types';
import { indexRecording } from './library-index';
import { publishIndexSnapshot, readIndexSnapshot, type IndexStorage } from './index-snapshots';

const directory = () => new Directory(Paths.document, 'recordings');
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
    },
    abort() {
      if (phase === 'complete' || phase === 'aborted') return;
      phase = 'aborted';
      close();
      if (part.exists) part.delete();
    },
  };
}
