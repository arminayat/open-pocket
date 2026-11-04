import { getTranscriptionProvider } from './providers';
import { TranscriptionError, transcriptionJsonRequest } from './request';
import type { ProviderId } from './types';

export interface ModelChoice { id: string; label: string; note?: string }

/** AssemblyAI's own fallback pair: universal-3-5-pro, then universal-2 for other languages. */
export const ASSEMBLY_AUTO = 'auto';
const MAX_MODELS = 200;

/** Shown when a provider has no listing API, or when the live list cannot be read. */
const KNOWN_MODELS: Record<ProviderId, ModelChoice[]> = {
  openai: [
    { id: 'gpt-transcribe', label: 'GPT Transcribe', note: 'Recommended' },
    { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
    { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe' },
    { id: 'whisper-1', label: 'Whisper' },
  ],
  groq: [
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo', note: 'Fastest' },
    { id: 'whisper-large-v3', label: 'Whisper Large v3', note: 'Most accurate' },
  ],
  deepgram: [
    { id: 'nova-3', label: 'Nova-3', note: 'Recommended' },
    { id: 'nova-2', label: 'Nova-2' },
  ],
  elevenlabs: [
    { id: 'scribe_v2', label: 'Scribe v2', note: 'Recommended' },
    { id: 'scribe_v2_medical', label: 'Scribe v2 Medical', note: 'Medical vocabulary' },
  ],
  assemblyai: [
    { id: ASSEMBLY_AUTO, label: 'Automatic', note: 'Universal-3.5 Pro, falling back to Universal-2 for other languages' },
    { id: 'universal-3-5-pro', label: 'Universal-3.5 Pro', note: '18 languages' },
    { id: 'universal-2', label: 'Universal-2', note: '99+ languages' },
  ],
};

/** Providers whose key can list its usable models; the others only verify the key. */
export function listsModels(provider: ProviderId): boolean {
  return provider === 'openai' || provider === 'groq' || provider === 'deepgram';
}

export function knownModels(provider: ProviderId): ModelChoice[] { return KNOWN_MODELS[provider]; }

/** Model IDs reach request URLs and form fields; accept only plain identifiers. */
export function validModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
}

export function defaultModel(provider: ProviderId): string {
  return provider === 'assemblyai' ? ASSEMBLY_AUTO : getTranscriptionProvider(provider).model;
}

/** The saved choice when it is still a valid identifier, otherwise the provider default. */
export function resolveModel(provider: ProviderId, chosen: string | undefined): string {
  return validModelId(chosen) ? chosen : defaultModel(provider);
}

function list(value: unknown, field: string): unknown[] {
  const items = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(items)) throw new TranscriptionError('invalid-response');
  return items.slice(0, 1000);
}

function field(item: unknown, name: string): unknown {
  return item && typeof item === 'object' ? (item as Record<string, unknown>)[name] : undefined;
}

function choice(provider: ProviderId, id: string, note?: string): ModelChoice {
  const known = KNOWN_MODELS[provider].find(model => model.id === id);
  return { id, label: known?.label ?? id, ...(note ?? known?.note ? { note: note ?? known?.note } : {}) };
}

/** Recommended model first, then known models in their listed order, then the rest alphabetically. */
function ordered(provider: ProviderId, models: ModelChoice[]): ModelChoice[] {
  const rank = (id: string) => {
    const index = KNOWN_MODELS[provider].findIndex(model => model.id === id);
    return index < 0 ? KNOWN_MODELS[provider].length : index;
  };
  const unique = [...new Map(models.map(model => [model.id, model])).values()];
  return unique.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)).slice(0, MAX_MODELS);
}

function retirement(value: unknown): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? `Retires ${date.toISOString().slice(0, 10)}` : undefined;
}

/** File transcription models only: Realtime-only and diarization models need other request shapes. */
function openAIModels(body: unknown): ModelChoice[] {
  return list(body, 'data').flatMap(item => {
    const id = field(item, 'id');
    if (!validModelId(id) || !/^(whisper|gpt-[\w.-]*transcribe)/.test(id) || id.startsWith('gpt-live') || id.includes('diarize')) return [];
    return [choice('openai', id, retirement(field(item, 'shutdown_date')))];
  });
}

function groqModels(body: unknown): ModelChoice[] {
  return list(body, 'data').flatMap(item => {
    const id = field(item, 'id');
    return validModelId(id) && id.startsWith('whisper') && field(item, 'active') !== false ? [choice('groq', id)] : [];
  });
}

/** Deepgram marks speech models itself; keep prerecorded (batch) ones, one per canonical name. */
function deepgramModels(body: unknown): ModelChoice[] {
  return list(body, 'stt').flatMap(item => {
    const id = field(item, 'canonical_name');
    return validModelId(id) && field(item, 'batch') === true ? [choice('deepgram', id)] : [];
  });
}

/** Verifies the key with the provider and returns the speech-to-text models it can use. */
export async function discoverModels(provider: ProviderId, key: string, fetcher: typeof fetch, signal: AbortSignal): Promise<ModelChoice[]> {
  const json = { Accept: 'application/json' };
  if (provider === 'openai' || provider === 'groq') {
    const url = provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.groq.com/openai/v1/models';
    const body = await transcriptionJsonRequest(url, { method: 'GET', headers: { ...json, Authorization: `Bearer ${key}` } }, signal, fetcher);
    const models = ordered(provider, provider === 'openai' ? openAIModels(body) : groqModels(body));
    if (!models.length) throw new TranscriptionError('invalid-response');
    return models;
  }
  if (provider === 'deepgram') {
    const body = await transcriptionJsonRequest('https://api.deepgram.com/v1/models',
      { method: 'GET', headers: { ...json, Authorization: `Token ${key}` } }, signal, fetcher);
    const models = ordered(provider, deepgramModels(body));
    if (!models.length) throw new TranscriptionError('invalid-response');
    return models;
  }
  // No listing API for speech models: check the key, then offer the documented models.
  if (provider === 'elevenlabs') {
    await transcriptionJsonRequest('https://api.elevenlabs.io/v1/models', { method: 'GET', headers: { ...json, 'xi-api-key': key } }, signal, fetcher);
  } else {
    await transcriptionJsonRequest('https://api.assemblyai.com/v2/transcript?limit=1', { method: 'GET', headers: { ...json, Authorization: key } }, signal, fetcher);
  }
  return KNOWN_MODELS[provider];
}
