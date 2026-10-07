import type { LocalRecording, Transport } from '../lib/pocket/types';

export type StoredRecording = Omit<LocalRecording, 'uri'> & { filename: string };

export function parseLibraryIndex(value: unknown): StoredRecording[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is StoredRecording => {
    if (!item || typeof item !== 'object') return false;
    return typeof item.filename === 'string' && /^[\w-]+\.mp3$/.test(item.filename) &&
      typeof item.id === 'string' && typeof item.date === 'string' && typeof item.timestamp === 'string' &&
      Number.isFinite(item.durationSeconds) && item.durationSeconds >= 0 &&
      Number.isSafeInteger(item.bytes) && item.bytes > 0 &&
      ['bluetooth', 'wifi'].includes(item.transport as Transport) && typeof item.downloadedAt === 'string';
  });
}

export function indexRecording(recording: LocalRecording, filename: string): StoredRecording {
  const { uri: _uri, ...metadata } = recording;
  return { ...metadata, filename };
}
