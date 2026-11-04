import type { LocalRecording } from '../pocket/types';
import { validModelId } from './models';
import { isProviderId } from './providers';
import type { ProviderId } from './types';

export interface TranscriptEntry {
  recordingKey: string;
  provider: ProviderId;
  status: 'pending' | 'complete' | 'error';
  jobId?: string;
  text?: string;
  model?: string;
  error?: string;
  errorCode?: string;
  updatedAt: string;
  /** Memory-only: a result/job remains usable when local publication fails. */
  unsaved?: boolean;
}

export interface TranscriptionCredentials {
  selectedProvider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  /** Chosen model per provider; absent means the provider default. */
  models?: Partial<Record<ProviderId, string>>;
  /** Provider the user agreed to automatic transcription with; absent means off. */
  autoTranscribe?: ProviderId;
}

export function validApiKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
}

/** Relative filename + recorder identity + exact size survive iOS container changes. */
export function recordingKey(recording: LocalRecording): string {
  const filename = recording.uri.split('/').pop();
  if (!filename || !/^[\w-]+\.mp3$/.test(filename) || !recording.id || recording.id.length > 200
    || !Number.isSafeInteger(recording.bytes) || recording.bytes <= 0) {
    throw new Error('The saved recording is invalid.');
  }
  return JSON.stringify([recording.id, filename, recording.bytes]);
}

export function resumableJob(entry: TranscriptEntry | undefined): boolean {
  return Boolean(entry?.jobId && entry.status !== 'complete'
    && entry.errorCode !== 'job-failed' && entry.errorCode !== 'job-not-found');
}

export function parseTranscriptionCredentials(text: string): TranscriptionCredentials {
  const value = JSON.parse(text);
  if (!value || !isProviderId(value.selectedProvider) || !value.keys || typeof value.keys !== 'object'
    || Array.isArray(value.keys)) throw new Error('Invalid saved transcription settings.');
  const keys: TranscriptionCredentials['keys'] = {};
  for (const [id, key] of Object.entries(value.keys)) {
    if (!isProviderId(id) || !validApiKey(key)) throw new Error('Invalid saved transcription key.');
    keys[id] = key;
  }
  // Older saved settings have no model choices.
  const models: NonNullable<TranscriptionCredentials['models']> = {};
  if (value.models !== undefined) {
    if (!value.models || typeof value.models !== 'object' || Array.isArray(value.models)) throw new Error('Invalid saved transcription models.');
    for (const [id, model] of Object.entries(value.models)) {
      if (!isProviderId(id) || !validModelId(model)) throw new Error('Invalid saved transcription model.');
      models[id] = model;
    }
  }
  if (value.autoTranscribe !== undefined && !isProviderId(value.autoTranscribe)) throw new Error('Invalid saved automatic transcription.');
  return { selectedProvider: value.selectedProvider, keys, models, ...(value.autoTranscribe ? { autoTranscribe: value.autoTranscribe } : {}) };
}

export function parseTranscripts(value: unknown): Record<string, TranscriptEntry> {
  if (!Array.isArray(value)) throw new Error('Invalid saved transcripts.');
  const entries: Record<string, TranscriptEntry> = {};
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.recordingKey !== 'string') throw new Error('Invalid transcript.');
    const identity = JSON.parse(item.recordingKey);
    if (!Array.isArray(identity) || identity.length !== 3
      || typeof identity[0] !== 'string' || !identity[0] || identity[0].length > 200
      || typeof identity[1] !== 'string' || !/^[\w-]+\.mp3$/.test(identity[1])
      || !Number.isSafeInteger(identity[2]) || identity[2] <= 0
      || !isProviderId(item.provider) || !['pending', 'complete', 'error'].includes(item.status)
      || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))
      || (item.jobId !== undefined && (item.provider !== 'assemblyai' || typeof item.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(item.jobId)))
      || (item.status === 'complete' && (typeof item.text !== 'string' || item.text.length > 2_000_000
        || typeof item.model !== 'string' || item.model.length > 100))
      || (item.errorCode !== undefined && (typeof item.errorCode !== 'string' || item.errorCode.length > 80))) {
      throw new Error('Invalid transcript.');
    }
    if (entries[item.recordingKey]) throw new Error('Duplicate saved transcript.');
    // Do not trust persisted provider error text or carry arbitrary fields into the UI.
    entries[item.recordingKey] = {
      recordingKey: item.recordingKey, provider: item.provider, status: item.status, updatedAt: item.updatedAt,
      ...(item.jobId ? { jobId: item.jobId } : {}),
      ...(item.status === 'complete' ? { text: item.text, model: item.model } : {}),
      ...(item.errorCode ? { errorCode: item.errorCode } : {}),
    };
  }
  return entries;
}
