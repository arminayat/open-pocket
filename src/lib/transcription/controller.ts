import type { LocalRecording } from '../pocket/types';
import { compareTranscriptArtifacts } from '../icloud/archive';
import type { TranscriptArtifact } from '../icloud/types';
import { untranscribed } from './auto';
import { knownModels, resolveModel, validModelId, type ModelChoice } from './models';
import { getTranscriptionProvider, validateTranscriptionFile } from './providers';
import { TranscriptionError, throwIfAborted } from './request';
import { parseTranscripts, recordingKey, resumableJob, validApiKey, type TranscriptionCredentials, type TranscriptEntry } from './state';
import type { ProviderId, TranscribeOptions, TranscriptionResult } from './types';

interface Dependencies {
  loadCredentials(): Promise<TranscriptionCredentials>;
  saveCredentials(value: TranscriptionCredentials): Promise<void>;
  loadEntries(): Promise<Record<string, TranscriptEntry>>;
  saveEntries(value: Record<string, TranscriptEntry>): Promise<void>;
  checkRecording(recording: LocalRecording): void;
  transcribe(options: TranscribeOptions): Promise<TranscriptionResult>;
  /** Checks the key with the provider and returns the speech models it can use. */
  listModels(provider: ProviderId, key: string, signal: AbortSignal): Promise<ModelChoice[]>;
  registerSecret(key: string): () => void;
}

/** Memory-only view of a provider's models. After a failed or rejected check, `models` holds the documented models. */
export interface ModelList {
  status: 'checking' | 'ready' | 'rejected' | 'failed';
  models: ModelChoice[];
}

class LocalError extends Error {}
const SAVE_ERROR = 'Could not save transcription data on this iPhone. Free some storage and try saving again.';

function transcriptVersion(entry: TranscriptEntry | null | undefined): string {
  return entry ? JSON.stringify([entry.recordingKey, entry.provider, entry.status, entry.updatedAt,
    entry.jobId ?? null, entry.text ?? null, entry.model ?? null, entry.errorCode ?? null, Boolean(entry.unsaved)]) : 'null';
}

/** One owner for credentials and billable requests; credentials never enter the React snapshot. */
export function createTranscriptionController(deps: Dependencies) {
  let credentials: TranscriptionCredentials | null = null;
  let entries: Record<string, TranscriptEntry> = {};
  let loading = true;
  let ready = false;
  let entriesReady = false;
  let saving = false;
  let error: string | null = null;
  let active: { recordingKey: string; provider: ProviderId; stage: string } | null = null;
  let controller: AbortController | null = null;
  let loadPromise: Promise<void> | undefined;
  let modelLists: Partial<Record<ProviderId, ModelList>> = {};
  const modelChecks = new Map<ProviderId, AbortController>();
  // Automatic runs try each recording once per app session and stop after a failure until resumed.
  const attempted = new Set<string>();
  let autoPaused = false;
  const listeners = new Set<() => void>();
  const redactors = new Map<ProviderId, () => void>();
  const notify = () => { for (const listener of listeners) listener(); };

  async function persistEntries() {
    try { await deps.saveEntries(entries); }
    catch { throw new LocalError(SAVE_ERROR); }
    entries = Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, { ...entry, unsaved: false }]));
    notify();
  }

  async function updateEntry(entry: TranscriptEntry) {
    entries = { ...entries, [entry.recordingKey]: { ...entry, unsaved: true } };
    notify();
    await persistEntries();
  }

  async function changeCredentials(work: (current: TranscriptionCredentials) => TranscriptionCredentials): Promise<boolean> {
    if (loading || saving || active) return false;
    if (!credentials) { error = 'Transcription settings could not be loaded. Restart OpenPocket to try again.'; notify(); return false; }
    saving = true;
    error = null;
    notify();
    const nextRedactors = new Map<ProviderId, () => void>();
    try {
      const next = work(credentials);
      for (const [provider, key] of Object.entries(next.keys)) {
        nextRedactors.set(provider as ProviderId, deps.registerSecret(key!));
      }
      await deps.saveCredentials(next);
      credentials = next;
      for (const remove of redactors.values()) remove();
      redactors.clear();
      for (const [provider, remove] of nextRedactors) redactors.set(provider, remove);
      nextRedactors.clear();
      return true;
    } catch (cause) {
      error = cause instanceof TranscriptionError ? cause.message : 'Could not save the API key or provider in Keychain. Please try again.';
      return false;
    } finally {
      for (const remove of nextRedactors.values()) remove();
      saving = false;
      notify();
    }
  }

  /** Read-only call with the saved key: verifies it and lists the speech models it can use. */
  async function refreshModels(id: ProviderId) {
    const key = credentials?.keys[id];
    if (!key) return;
    modelChecks.get(id)?.abort();
    const check = new AbortController();
    modelChecks.set(id, check);
    modelLists = { ...modelLists, [id]: { status: 'checking', models: modelLists[id]?.models ?? [] } };
    notify();
    let next: ModelList;
    try {
      next = { status: 'ready', models: await deps.listModels(id, key, check.signal) };
    } catch (cause) {
      if (check.signal.aborted) return;
      // Offer documented models so a temporary failure does not block choosing one.
      next = { status: cause instanceof TranscriptionError && cause.code === 'authentication' ? 'rejected' : 'failed',
        models: knownModels(id) };
    } finally {
      if (modelChecks.get(id) === check) modelChecks.delete(id);
    }
    if (check.signal.aborted) return;
    modelLists = { ...modelLists, [id]: next };
    notify();
  }

  const api = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot() {
      const selectedProvider = credentials?.selectedProvider ?? 'openai' as ProviderId;
      const selectedModels = Object.fromEntries((Object.keys(credentials?.keys ?? {}) as ProviderId[])
        .concat(selectedProvider).map(id => [id, resolveModel(id, credentials?.models?.[id])])) as Partial<Record<ProviderId, string>>;
      return { loading, saving, selectedProvider, savedProviders: Object.keys(credentials?.keys ?? {}) as ProviderId[],
        selectedModels, modelLists, active, error, entries,
        autoTranscribe: Boolean(credentials?.autoTranscribe && credentials.autoTranscribe === selectedProvider), autoPaused };
    },
    load() {
      loadPromise ??= (async () => {
        // Load independently so saved transcripts remain readable if Keychain is temporarily unavailable.
        const results = await Promise.allSettled([deps.loadCredentials(), deps.loadEntries()]);
        if (results[0].status === 'fulfilled') {
          credentials = results[0].value;
          for (const [id, key] of Object.entries(credentials.keys)) redactors.set(id as ProviderId, deps.registerSecret(key!));
        }
        if (results[1].status === 'fulfilled') { entries = results[1].value; entriesReady = true; }
        ready = results.every(result => result.status === 'fulfilled');
        if (!ready) error = 'Saved transcription settings or transcripts could not be read. Restart OpenPocket to try again. No audio was uploaded.';
        loading = false;
        notify();
      })();
      return loadPromise;
    },
    async selectProvider(id: ProviderId) {
      await changeCredentials(current => { getTranscriptionProvider(id); return { ...current, selectedProvider: id }; });
    },
    async saveKey(id: ProviderId, value: string): Promise<boolean> {
      const saved = await changeCredentials(current => {
        getTranscriptionProvider(id);
        const key = value.trim();
        if (!validApiKey(key)) throw new TranscriptionError('invalid-key');
        return { ...current, selectedProvider: id, keys: { ...current.keys, [id]: key } };
      });
      // A new key may see different models; check it right away.
      if (saved) void refreshModels(id);
      return saved;
    },
    async removeKey(id: ProviderId) {
      const removed = await changeCredentials(current => {
        getTranscriptionProvider(id);
        const keys = { ...current.keys };
        delete keys[id];
        return { ...current, keys };
      });
      if (removed) {
        modelChecks.get(id)?.abort();
        const { [id]: _removed, ...rest } = modelLists;
        modelLists = rest;
        notify();
      }
    },
    async selectModel(id: ProviderId, model: string) {
      await changeCredentials(current => {
        getTranscriptionProvider(id);
        if (!validModelId(model)) throw new TranscriptionError('invalid-request');
        return { ...current, models: { ...current.models, [id]: model } };
      });
    },
    refreshModels,
    /** Consent is bound to the selected provider; switching providers turns automatic transcription off. */
    async setAutoTranscribe(enabled: boolean) {
      const changed = await changeCredentials(current => {
        const { autoTranscribe: _previous, ...rest } = current;
        return enabled ? { ...rest, autoTranscribe: current.selectedProvider } : rest;
      });
      if (changed) { autoPaused = false; notify(); }
    },
    resumeAuto() { if (autoPaused) { autoPaused = false; notify(); } },
    /** Starts the next untranscribed recording when automatic transcription is on and nothing else is running. */
    async autoTranscribe(library: LocalRecording[]) {
      if (loading || saving || active || !ready || !credentials || autoPaused) return;
      const provider = credentials.selectedProvider;
      if (credentials.autoTranscribe !== provider || !credentials.keys[provider]) return;
      const next = untranscribed(library, entries).find(recording => !attempted.has(recordingKey(recording)));
      if (!next) return;
      const key = recordingKey(next);
      attempted.add(key);
      await api.start(next, provider);
      // Local pre-checks (too large, missing audio) only skip this recording; a failed request pauses the rest.
      if (entries[key]?.status === 'error') { autoPaused = true; notify(); }
    },
    clearError() { error = null; notify(); },
    cancel() {
      if (active && controller) {
        active = { ...active, stage: 'Stopping transcription' };
        controller.abort();
        notify();
      }
    },
    async mergeTranscript(recording: LocalRecording, artifact: TranscriptArtifact, expectedEntry?: TranscriptEntry | null): Promise<void> {
      if (loading || saving || active) throw new Error('Transcription is busy. Try syncing again when it finishes.');
      if (!entriesReady) throw new Error('Saved transcripts could not be read. Restart OpenPocket before syncing transcripts.');
      let nextEntry: TranscriptEntry;
      let key: string;
      try {
        key = recordingKey(recording);
        if (artifact.schema !== 1 || artifact.kind !== 'transcript' || !artifact.model
          || /[\x00-\x1f\x7f]/.test(artifact.model) || new Date(artifact.updatedAt).toISOString() !== artifact.updatedAt) {
          throw new Error('Invalid transcript.');
        }
        nextEntry = parseTranscripts([{
          recordingKey: key, provider: artifact.provider, status: 'complete', text: artifact.text,
          model: artifact.model, updatedAt: artifact.updatedAt,
        }])[key];
      } catch { throw new Error('The iCloud transcript is invalid. The saved transcript was kept.'); }
      const previous = entries[key];
      if (expectedEntry !== undefined && transcriptVersion(previous) !== transcriptVersion(expectedEntry)) {
        throw new Error('The local transcript changed during sync. Try syncing again to save its current version first.');
      }
      if (previous?.unsaved || previous?.status === 'pending' || resumableJob(previous)) {
        throw new Error('This recording has an unfinished or unsaved transcription. Finish or save it before syncing its transcript.');
      }
      if (previous?.status === 'complete') {
        const current: TranscriptArtifact = {
          schema: 1, kind: 'transcript', text: previous.text!, updatedAt: previous.updatedAt,
          provider: previous.provider, model: previous.model!,
        };
        if (compareTranscriptArtifacts(artifact, current) <= 0) return;
      }
      saving = true;
      notify();
      try {
        const next = { ...entries, [key]: nextEntry };
        await deps.saveEntries(next);
        entries = next;
      } catch { throw new Error('The iCloud transcript could not be saved on this device. Try syncing again.'); }
      finally { saving = false; notify(); }
    },
    async start(recording: LocalRecording, expectedProvider?: ProviderId) {
      if (loading || saving || active) return;
      if (!ready || !credentials) {
        error = 'Saved transcription data could not be loaded. Restart OpenPocket before trying again.';
        notify();
        return;
      }
      let key: string;
      try { key = recordingKey(recording); }
      catch { error = 'The saved recording is invalid.'; notify(); return; }
      const previous = entries[key];
      if (previous?.status === 'complete' && !previous.unsaved) return;
      const resume = resumableJob(previous);
      const provider = resume || previous?.status === 'complete' ? previous.provider : credentials.selectedProvider;
      if (expectedProvider && expectedProvider !== provider) {
        error = 'The transcription provider changed. Review the selected provider and confirm again.';
        notify();
        return;
      }
      controller = new AbortController();
      const signal = controller.signal;
      active = { recordingKey: key, provider, stage: previous?.status === 'complete' ? 'Saving transcript' : 'Preparing transcription' };
      error = null;
      notify();
      let submitted = false;
      let prepared = false;
      try {
        if (previous?.status === 'complete') { await persistEntries(); return; }
        const apiKey = credentials.keys[provider];
        if (!apiKey) throw new LocalError(`Add your ${getTranscriptionProvider(provider).name} API key in Settings first.`);
        if (!resume) {
          validateTranscriptionFile(provider, recording.bytes, recording.durationSeconds);
          try { deps.checkRecording(recording); }
          catch { throw new LocalError('The downloaded audio is missing or has changed. Download it again before transcribing.'); }
        }
        // Persist the intent before any network request. A crash then shows an interrupted attempt,
        // never an automatically retried billable request. Retain known jobs even if saving failed.
        prepared = true;
        await updateEntry({ recordingKey: key, provider, status: 'pending', updatedAt: new Date().toISOString(),
          ...(resume ? { jobId: previous.jobId } : {}) });
        throwIfAborted(signal);
        submitted = true;
        const result = await deps.transcribe({
          provider, key: apiKey, model: resolveModel(provider, credentials.models?.[provider]),
          uri: recording.uri, signal, jobId: resume ? previous.jobId : undefined,
          onStage(stage) { active = { recordingKey: key, provider, stage }; notify(); },
          async onJob(jobId) {
            // Preserve the accepted receipt in memory even when disk is full; the next attempt saves it first.
            await updateEntry({ ...entries[key], jobId, updatedAt: new Date().toISOString() });
          },
        });
        // Receipt wins over cancellation: do not discard an already returned billable result.
        await updateEntry({ ...entries[key], status: 'complete', ...result, error: undefined, errorCode: undefined,
          updatedAt: new Date().toISOString() });
      } catch (cause) {
        error = cause instanceof TranscriptionError || cause instanceof LocalError ? cause.message
          : 'Transcription could not finish. Check your provider account before trying again; it may still process and charge for the request.';
        // A save failure must not replace a usable completed transcript with an error.
        if (prepared && entries[key] && entries[key].status !== 'complete') {
          entries = { ...entries, [key]: { ...entries[key], status: 'error', error,
            errorCode: cause instanceof TranscriptionError ? cause.code : submitted ? 'storage' : 'local', unsaved: true } };
          try { await persistEntries(); } catch { /* Keep the result/receipt in memory and the prior disk snapshot. */ }
        }
      } finally {
        controller = null;
        active = null;
        notify();
      }
    },
  };
  return api;
}
