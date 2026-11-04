import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { DEFAULT_AI_SETTINGS, parseAiSettings, parseSummaries, type AiSettings, type SummaryEntry } from '@/lib/ai/state';
import { publishSnapshot, readSnapshot, type IndexStorage } from './index-snapshots';

const STORE_KEY = 'openpocket.ai.v1';

export async function loadAiSettings(): Promise<AiSettings> {
  const text = await SecureStore.getItemAsync(STORE_KEY);
  return text ? parseAiSettings(text) : DEFAULT_AI_SETTINGS;
}

export async function saveAiSettings(value: AiSettings): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** `ai-summaries`, not `summaries`: that older folder held hand-written text, now notes. */
function storage(): IndexStorage {
  const folder = new Directory(Paths.document, 'ai-summaries');
  folder.create({ idempotent: true, intermediates: true });
  return {
    list: () => folder.list().filter((item): item is File => item instanceof File).map(item => item.name),
    read: name => new File(folder, name).text(),
    write: (name, text) => new File(folder, name).write(text),
    move: (from, to) => new File(folder, from).move(new File(folder, to)),
    remove: name => { const file = new File(folder, name); if (file.exists) file.delete(); },
  };
}

export function loadSummaries(): Promise<Record<string, SummaryEntry>> {
  return readSnapshot(storage(), parseSummaries, {});
}

export async function saveSummaries(entries: Record<string, SummaryEntry>): Promise<void> {
  publishSnapshot(storage(), Object.values(entries));
}
