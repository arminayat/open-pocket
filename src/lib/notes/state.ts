export interface NoteEntry {
  recordingKey: string;
  text: string;
  updatedAt: string;
  revision: string;
}

export const MAX_NOTE_LENGTH = 100_000;
const revisionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Keep the same relative identity as transcription; no device container paths. */
export function parseNotes(value: unknown): Record<string, NoteEntry> {
  if (!Array.isArray(value)) throw new Error('Invalid saved notes.');
  const entries: Record<string, NoteEntry> = {};
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.recordingKey !== 'string') {
      throw new Error('Invalid saved note.');
    }
    const identity = JSON.parse(item.recordingKey);
    if (!Array.isArray(identity) || identity.length !== 3
      || typeof identity[0] !== 'string' || !identity[0] || identity[0].length > 200
      || typeof identity[1] !== 'string' || !/^[\w-]+\.mp3$/.test(identity[1])
      || !Number.isSafeInteger(identity[2]) || identity[2] <= 0
      || JSON.stringify(identity) !== item.recordingKey
      || typeof item.text !== 'string' || item.text.length > MAX_NOTE_LENGTH
      || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))
      || typeof item.revision !== 'string' || !revisionPattern.test(item.revision)) {
      throw new Error('Invalid saved note.');
    }
    if (entries[item.recordingKey]) throw new Error('Duplicate saved note.');
    entries[item.recordingKey] = {
      recordingKey: item.recordingKey, text: item.text, updatedAt: item.updatedAt, revision: item.revision,
    };
  }
  return entries;
}

/** A stable tie-breaker makes independent devices converge on the same version. */
export function compareNoteEntries(a: NoteEntry, b: NoteEntry): number {
  const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  return time || (a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0);
}
