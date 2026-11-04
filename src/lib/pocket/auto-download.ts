import type { LocalRecording, Recording } from './types';

/** First recording (listing is newest first) with no local copy that wasn't skipped this connection. */
export function nextAutoDownload(recordings: Recording[], library: LocalRecording[], skipped: ReadonlySet<string>): Recording | null {
  return recordings.find(item => !skipped.has(item.id) && !library.some(file => file.id === item.id)) ?? null;
}

/** Spacing between automatic reconnects, so an absent or asleep recorder doesn't keep Bluetooth busy. */
export const AUTO_RECONNECT_RETRY_MS = 30_000;

export function autoReconnectDue(lastAttempt: number | null, now: number): boolean {
  return lastAttempt === null || now - lastAttempt >= AUTO_RECONNECT_RETRY_MS;
}
