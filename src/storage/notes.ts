import { Directory, File, Paths } from 'expo-file-system';
import { parseNotes, type NoteEntry } from '@/lib/notes/state';
import { publishSnapshot, readSnapshot, type IndexStorage } from './index-snapshots';

function storage(): IndexStorage {
  const folder = new Directory(Paths.document, 'notes');
  folder.create({ idempotent: true, intermediates: true });
  return {
    list: () => folder.list().filter((item): item is File => item instanceof File).map(item => item.name),
    read: name => new File(folder, name).text(),
    write: (name, text) => new File(folder, name).write(text),
    move: (from, to) => new File(folder, from).move(new File(folder, to)),
    remove: name => { const file = new File(folder, name); if (file.exists) file.delete(); },
  };
}

export function loadNotes(): Promise<Record<string, NoteEntry>> {
  return readSnapshot(storage(), parseNotes, {});
}

export async function saveNotes(entries: Record<string, NoteEntry>): Promise<void> {
  publishSnapshot(storage(), Object.values(entries));
}
