import type { LocalRecording, Recording } from './types';

/** The recorder's listing plus recordings only saved on this iPhone, newest first. */
export function mergeRecordings(listing: Recording[], library: LocalRecording[]): Recording[] {
  const records = [...listing];
  for (const local of library) if (!records.some(item => item.id === local.id)) records.push(local);
  return records.sort((a, b) => `${b.date}${b.timestamp}`.localeCompare(`${a.date}${a.timestamp}`));
}

/** A recording can be saved by more than one transport; the most recent download wins. */
export function latestCopy(library: LocalRecording[], id: string): LocalRecording | undefined {
  return library.filter(item => item.id === id).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))[0];
}

/** `HH:MM` from Pocket's `YYYYMMDDHHMMSS` timestamp; other formats are shown as-is. */
export function recordingTime(recording: Recording): string {
  const { timestamp } = recording;
  return timestamp.length === 14 ? `${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}` : timestamp;
}

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
