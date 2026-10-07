import { parseLibraryIndex, type StoredRecording } from './library-index';

export interface IndexStorage {
  list(): string[];
  read(name: string): Promise<string>;
  write(name: string, contents: string): void;
  move(from: string, to: string): void;
  remove(name: string): void;
}

const snapshotPattern = /^index-(\d{12})\.json$/;
const version = (name: string) => Number(snapshotPattern.exec(name)?.[1] ?? 0);
const isIndex = (name: string) => name === 'index.json' || snapshotPattern.test(name);

export async function readIndexSnapshot(storage: IndexStorage): Promise<StoredRecording[]> {
  const names = storage.list().filter(isIndex).sort((a, b) => version(b) - version(a));
  for (const name of names) {
    try {
      const value: unknown = JSON.parse(await storage.read(name));
      if (Array.isArray(value)) return parseLibraryIndex(value);
    } catch { /* A prior snapshot remains usable after an interrupted publication. */ }
  }
  return [];
}

/** Publish to a fresh filename: Expo's overwrite move removes the old target
 * first. Same-directory rename to an unused name preserves the prior index. */
export function publishIndexSnapshot(storage: IndexStorage, entries: StoredRecording[]): void {
  const previous = storage.list().filter(isIndex);
  const nextVersion = Math.max(0, ...previous.map(version)) + 1;
  const name = `index-${String(nextVersion).padStart(12, '0')}.json`;
  const temporary = `${name}.part`;
  try {
    storage.write(temporary, JSON.stringify(entries));
    storage.move(temporary, name);
  } catch (error) {
    try { storage.remove(temporary); } catch { /* Preserve the publication error. */ }
    throw error;
  }
  for (const old of previous) {
    try { storage.remove(old); } catch { /* The newest snapshot wins if pruning fails. */ }
  }
}
