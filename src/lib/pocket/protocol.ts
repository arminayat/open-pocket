/** Pocket Libre protocol, MIT, shahcolate; see THIRD_PARTY_NOTICES.md. */
import type { Recording } from './types';

export const PRIMARY = {
  service: '001120a0-2233-4455-6677-889912345678',
  write: '001120a3-2233-4455-6677-889912345678',
  notify: '001120a3-2233-4455-6677-889912345678',
  audioService: '001120a0-2233-4455-6677-889912345678',
  audio: '001120a1-2233-4455-6677-889912345678',
};
export const LEGACY = {
  service: 'e49a3001-f69a-11e8-8eb2-f2801f1b9fd1',
  write: 'e49a3002-f69a-11e8-8eb2-f2801f1b9fd1',
  notify: 'e49a3003-f69a-11e8-8eb2-f2801f1b9fd1',
  audioService: 'e49a25f8-f69a-11e8-8eb2-f2801f1b9fd1',
  audio: 'e49a28e1-f69a-11e8-8eb2-f2801f1b9fd1',
};
export const WIFI_END_MARKER = Uint8Array.from([0xba, 0x5a, 2, 0x8f, 4, 0xba, 0x5a, 2, 0x8f, 4]);

export class PocketError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PocketError';
  }
}

export const cancelledError = () => new PocketError('cancelled', 'Transfer cancelled.');
export const disconnectedError = () => new PocketError('disconnected', 'Pocket disconnected. Wake it, close the official app, and reconnect.');

export interface Response { name: string; value: string }
export function parseResponse(text: string): Response | null {
  const match = /^MCU&([A-Z_]+)(?:&(.*))?$/.exec(text.replace(/\0/g, '').trim());
  if (!match) return null;
  return { name: match[1], value: match[2] ?? '' };
}

/** Notifications may combine replies or split a prefix/fields. Flush at a quiet
 * notification boundary, since this protocol has no newline or length frame. */
export class ResponseDecoder {
  private buffer = '';
  feed(text: string): Response[] {
    this.buffer += text.replace(/\0/g, '');
    if (this.buffer.length > 8192) throw new PocketError('protocol', 'Pocket sent an oversized control response. Reconnect and retry.');
    const replies: Response[] = [];
    let start = this.buffer.indexOf('MCU&');
    if (start < 0) return replies;
    this.buffer = this.buffer.slice(start);
    start = this.buffer.indexOf('MCU&', 4);
    while (start >= 0) {
      const parsed = parseResponse(this.buffer.slice(0, start));
      if (parsed) replies.push(parsed);
      this.buffer = this.buffer.slice(start);
      start = this.buffer.indexOf('MCU&', 4);
    }
    return replies;
  }
  flush(): Response[] {
    const parsed = parseResponse(this.buffer);
    // An unfinished prefix stays buffered until its next notification.
    if (!parsed) return [];
    const minimumFields: Record<string, number> = { SK: 1, BAT: 1, FW: 1, WF: 1, U: 1, WIFI: 2, F: 3, DIRS: 1, DIRS_SUM: 1, LIST: 1, WIFIS: 1 };
    const fields = parsed.value.split('&');
    const minimum = minimumFields[parsed.name];
    if (minimum && (fields.length < minimum || fields.slice(0, minimum).some(field => !field))) return [];
    this.buffer = '';
    return [parsed];
  }
}

export function nonnegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function positiveSize(value: string): number | null {
  const n = nonnegativeInteger(value);
  return n !== null && n > 0 ? n : null;
}
export function safeIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value !== '.' && value !== '..' && /^[A-Za-z0-9._-]+$/.test(value);
}
export function parseRecording(value: string, expectedDate: string): Recording {
  const parts = value.split('&');
  const duration = nonnegativeInteger(parts[2] ?? '');
  if (parts.length !== 3 || parts[0] !== expectedDate || !safeIdentifier(parts[0]) || !safeIdentifier(parts[1]) || duration === null) {
    throw new PocketError('listing', 'Pocket returned an invalid recording entry. Refresh the list after reconnecting.');
  }
  return { id: `${parts[0]}/${parts[1]}`, date: parts[0], timestamp: parts[1], durationSeconds: duration };
}
export function validateDirectories(entries: Response[], count: string): string[] {
  const dirs = entries.filter(e => e.name === 'DIRS').map(e => e.value);
  if (nonnegativeInteger(count) !== dirs.length || new Set(dirs).size !== dirs.length || dirs.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new PocketError('listing', 'The recording directory list was incomplete. Reconnect and refresh.');
  }
  return dirs;
}
export function validateListing(entries: Response[], count: string, date: string): Recording[] {
  const files = entries.filter(e => e.name === 'F');
  if (nonnegativeInteger(count) !== files.length) throw new PocketError('listing', 'The recording list was incomplete. Reconnect and refresh.');
  const recordings = files.map(e => parseRecording(e.value, date));
  if (new Set(recordings.map(r => r.id)).size !== recordings.length) throw new PocketError('listing', 'Pocket returned duplicate recording entries. Reconnect and refresh.');
  return recordings;
}
export function validateDeviceKey(key: string): void {
  if (!/^[\x21-\x25\x27-\x7e]{16}$/.test(key)) throw new PocketError('key', 'The device key must contain exactly 16 printable characters, without an ampersand.');
}

/** Bounded accounting; actual bytes are written directly to the file. */
export class TransferCounter {
  bytes = 0;
  expected: number | null = null;
  ended = false;
  add(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0) throw new PocketError('transfer', 'Invalid audio notification.');
    this.bytes += length;
    this.validateLimit();
  }
  expect(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new PocketError('transfer', 'Pocket did not report a valid recording size.');
    if (this.expected !== null && this.expected !== value) throw new PocketError('transfer', 'Pocket changed the recording size during transfer. Retry after reconnecting.');
    this.expected = value;
    this.validateLimit();
  }
  finish(): number {
    this.ended = true;
    if (this.expected === null || this.bytes !== this.expected) throw new PocketError('transfer', 'Recording ended before its reported size was received. Retry the download.');
    return this.bytes;
  }
  private validateLimit(): void {
    if (!Number.isSafeInteger(this.bytes) || (this.expected !== null && this.bytes > this.expected)) throw new PocketError('transfer', 'Recording exceeded its reported size. Reconnect and retry.');
  }
}
