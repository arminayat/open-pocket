import { validApiKey } from '../transcription/state';
import { isAiProviderId, validAiModelId, type AiKeyProviderId, type AiProviderId } from './providers';

/** Keychain record. ChatGPT has no key here: it uses the ChatGPT account's plan token. */
export interface AiSettings {
  selectedProvider: AiProviderId;
  keys: Partial<Record<AiKeyProviderId, string>>;
  models: Partial<Record<AiProviderId, string>>;
  /** Provider the user agreed to automatic summaries with; absent means off. */
  autoSummarize?: AiProviderId;
}

export interface SummaryEntry {
  recordingKey: string;
  provider: AiProviderId;
  model: string;
  title: string;
  summary: string;
  updatedAt: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { selectedProvider: 'chatgpt', keys: {}, models: {} };

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

export function parseAiSettings(text: string): AiSettings {
  const value = record(JSON.parse(text), 'Invalid saved AI settings.');
  if (!isAiProviderId(value.selectedProvider)) throw new Error('Invalid saved AI settings.');
  const keys: AiSettings['keys'] = {};
  for (const [id, key] of Object.entries(record(value.keys ?? {}, 'Invalid saved AI keys.'))) {
    if (!isAiProviderId(id) || id === 'chatgpt' || !validApiKey(key)) throw new Error('Invalid saved AI key.');
    keys[id] = key;
  }
  const models: AiSettings['models'] = {};
  for (const [id, model] of Object.entries(record(value.models ?? {}, 'Invalid saved AI models.'))) {
    if (!isAiProviderId(id) || !validAiModelId(model)) throw new Error('Invalid saved AI model.');
    models[id] = model;
  }
  if (value.autoSummarize !== undefined && !isAiProviderId(value.autoSummarize)) throw new Error('Invalid saved AI settings.');
  return { selectedProvider: value.selectedProvider, keys, models, ...(value.autoSummarize ? { autoSummarize: value.autoSummarize } : {}) };
}

/** Same relative recording identity as transcripts and notes; no device container paths. */
function validRecordingKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const identity = JSON.parse(value);
    return Array.isArray(identity) && identity.length === 3
      && typeof identity[0] === 'string' && Boolean(identity[0]) && identity[0].length <= 200
      && typeof identity[1] === 'string' && /^[\w-]+\.mp3$/.test(identity[1])
      && Number.isSafeInteger(identity[2]) && identity[2] > 0 && JSON.stringify(identity) === value;
  } catch { return false; }
}

export function parseSummaries(value: unknown): Record<string, SummaryEntry> {
  if (!Array.isArray(value)) throw new Error('Invalid saved summaries.');
  const entries: Record<string, SummaryEntry> = {};
  for (const item of value) {
    const entry = record(item, 'Invalid saved summary.');
    if (!validRecordingKey(entry.recordingKey) || !isAiProviderId(entry.provider) || !validAiModelId(entry.model)
      || typeof entry.title !== 'string' || !entry.title || entry.title.length > 80
      || typeof entry.summary !== 'string' || !entry.summary || entry.summary.length > 20_000
      || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) {
      throw new Error('Invalid saved summary.');
    }
    if (entries[entry.recordingKey]) throw new Error('Duplicate saved summary.');
    entries[entry.recordingKey] = { recordingKey: entry.recordingKey, provider: entry.provider, model: entry.model,
      title: entry.title, summary: entry.summary, updatedAt: entry.updatedAt };
  }
  return entries;
}

/** Newest wins; a stable payload tie-breaker makes independent devices converge on the same version. */
export function compareSummaries(a: SummaryEntry, b: SummaryEntry): number {
  const date = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  const aTie = JSON.stringify([a.provider, a.model, a.title, a.summary]);
  const bTie = JSON.stringify([b.provider, b.model, b.title, b.summary]);
  return date || (aTie < bTie ? -1 : aTie > bTie ? 1 : 0);
}
