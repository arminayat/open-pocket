import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import type { LocalRecording } from '@/lib/pocket/types';
import { parseTranscriptionCredentials, parseTranscripts, type TranscriptionCredentials, type TranscriptEntry } from '@/lib/transcription/state';
import { publishSnapshot, readSnapshot, type IndexStorage } from './index-snapshots';

const STORE_KEY = 'openpocket.transcription.v1';

export async function loadTranscriptionCredentials(): Promise<TranscriptionCredentials> {
  const text = await SecureStore.getItemAsync(STORE_KEY);
  return text ? parseTranscriptionCredentials(text) : { selectedProvider: 'openai', keys: {} };
}

export async function saveTranscriptionCredentials(value: TranscriptionCredentials): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

function storage(): IndexStorage {
  const folder = new Directory(Paths.document, 'transcripts');
  folder.create({ idempotent: true, intermediates: true });
  return {
    list: () => folder.list().filter((item): item is File => item instanceof File).map(item => item.name),
    read: name => new File(folder, name).text(),
    write: (name, text) => new File(folder, name).write(text),
    move: (from, to) => new File(folder, from).move(new File(folder, to)),
    remove: name => { const file = new File(folder, name); if (file.exists) file.delete(); },
  };
}

export function loadTranscripts(): Promise<Record<string, TranscriptEntry>> {
  return readSnapshot(storage(), parseTranscripts, {});
}

export async function saveTranscripts(entries: Record<string, TranscriptEntry>): Promise<void> {
  const values = Object.values(entries).map(({ unsaved: _unsaved, error: _error, ...entry }) => entry);
  publishSnapshot(storage(), values);
}

export function checkTranscriptionRecording(recording: LocalRecording): void {
  const file = new File(recording.uri);
  const folder = new Directory(Paths.document, 'recordings');
  if (file.parentDirectory.uri !== folder.uri || !/^[\w-]+\.mp3$/.test(file.name)
    || !file.exists || file.size !== recording.bytes) {
    throw new Error('The downloaded audio is missing or has changed.');
  }
}
