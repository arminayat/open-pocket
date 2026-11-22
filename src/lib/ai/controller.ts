import type { LocalRecording } from '../pocket/types';
import { recordingKey, validApiKey } from '../transcription/state';
import type { SummaryCandidate } from './auto';
import type { AiCredential, AiSummaryResult } from './generate';
import { getAiProvider, resolveAiModel, validAiModelId, type AiKeyProviderId, type AiModelChoice, type AiProviderId } from './providers';
import { AiError } from './request';
import { compareSummaries, parseSummaries, type AiSettings, type SummaryEntry } from './state';

interface Dependencies {
  loadSettings(): Promise<AiSettings>;
  saveSettings(value: AiSettings): Promise<void>;
  loadEntries(): Promise<Record<string, SummaryEntry>>;
  saveEntries(value: Record<string, SummaryEntry>): Promise<void>;
  /** The active ChatGPT account's access token when plan usage is allowed, refreshed if needed. */
  planToken(): Promise<string | null>;
  /** Runs OpenRouter's sign-in and returns the key it issued. */
  authorizeOpenRouter(): Promise<string>;
  summarize(credential: AiCredential, model: string, transcript: string, signal: AbortSignal): Promise<AiSummaryResult>;
  listModels(credential: AiCredential, signal: AbortSignal): Promise<AiModelChoice[]>;
  registerSecret(secret: string): () => void;
  /** Each failed provider call with what was being done, so the provider's reason reaches the Debug log. */
  onError?(context: string, cause: unknown): void;
  now?(): number;
}

/** Memory-only view of a provider's models; after a failed or rejected check `models` holds the documented ones. */
export interface AiModelList { status: 'checking' | 'ready' | 'rejected' | 'failed'; models: AiModelChoice[] }

const LOAD_ERROR = 'Saved AI settings or summaries could not be read. Restart Open Pocket to try again.';
const SAVE_ERROR = 'Could not save AI settings in Keychain. Please try again.';
const message = (cause: unknown, fallback: string) => cause instanceof AiError ? cause.message : fallback;

/** One owner for AI credentials and billable summary requests; keys and tokens never enter the snapshot. */
export function createAiController(deps: Dependencies) {
  let settings: AiSettings | null = null;
  let entries: Record<string, SummaryEntry> = {};
  let loading = true;
  let saving = false;
  let error: string | null = null;
  let failures: Record<string, string> = {};
  let active: { recordingKey: string; provider: AiProviderId } | null = null;
  let controller: AbortController | null = null;
  let modelLists: Partial<Record<AiProviderId, AiModelList>> = {};
  let loadPromise: Promise<void> | undefined;
  // Automatic runs try each recording once per app session and stop after a failure until resumed.
  const attempted = new Set<string>();
  let autoPaused = false;
  const modelChecks = new Map<AiProviderId, AbortController>();
  const redactors = new Map<AiKeyProviderId, () => void>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };

  function protect(next: AiSettings) {
    for (const remove of redactors.values()) remove();
    redactors.clear();
    for (const [id, key] of Object.entries(next.keys)) redactors.set(id as AiKeyProviderId, deps.registerSecret(key!));
  }

  async function changeSettings(work: (current: AiSettings) => AiSettings): Promise<boolean> {
    if (loading || saving || active) return false;
    if (!settings) { error = LOAD_ERROR; notify(); return false; }
    saving = true;
    error = null;
    notify();
    try {
      const next = work(settings);
      await deps.saveSettings(next);
      settings = next;
      protect(next);
      return true;
    } catch (cause) {
      error = message(cause, SAVE_ERROR);
      return false;
    } finally { saving = false; notify(); }
  }

  /** The saved choice; otherwise the recommended model, or the first listed one when the live list lacks it. */
  function modelFor(id: AiProviderId): string {
    const chosen = settings?.models[id];
    if (validAiModelId(chosen)) return chosen;
    const fallback = resolveAiModel(id, undefined);
    const list = modelLists[id];
    return list?.status === 'ready' && list.models.length && !list.models.some(model => model.id === fallback) ? list.models[0].id : fallback;
  }

  async function credential(provider: AiProviderId): Promise<AiCredential> {
    if (provider === 'chatgpt') {
      const token = await deps.planToken();
      if (!token) throw new AiError('not-signed-in');
      return { provider, secret: token };
    }
    const key = settings?.keys[provider];
    if (!key) throw new AiError('no-key');
    return { provider, secret: key };
  }

  /** Read-only call with the saved credential: verifies it and lists the text models it can use. */
  async function refreshModels(id: AiProviderId) {
    if (!settings) return;
    modelChecks.get(id)?.abort();
    const check = new AbortController();
    modelChecks.set(id, check);
    modelLists = { ...modelLists, [id]: { status: 'checking', models: modelLists[id]?.models ?? [] } };
    notify();
    let next: AiModelList;
    try {
      next = { status: 'ready', models: await deps.listModels(await credential(id), check.signal) };
    } catch (cause) {
      if (check.signal.aborted) return;
      deps.onError?.(`Listing ${getAiProvider(id).name} models`, cause);
      const rejected = cause instanceof AiError && ['authentication', 'no-key', 'not-signed-in', 'workspace-key', 'plan-not-eligible'].includes(cause.code);
      next = { status: rejected ? 'rejected' : 'failed', models: getAiProvider(id).models };
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
      const selectedProvider = settings?.selectedProvider ?? 'chatgpt';
      const selectedModels = Object.fromEntries((['chatgpt', 'openai', 'anthropic', 'openrouter'] as AiProviderId[])
        .map(id => [id, modelFor(id)])) as Record<AiProviderId, string>;
      return {
        loading, saving, error, failures, active, entries, modelLists, autoPaused, selectedProvider, selectedModels,
        savedProviders: Object.keys(settings?.keys ?? {}) as AiKeyProviderId[],
        autoSummarize: Boolean(settings?.autoSummarize && settings.autoSummarize === selectedProvider),
      };
    },
    load() {
      loadPromise ??= (async () => {
        const results = await Promise.allSettled([deps.loadSettings(), deps.loadEntries()]);
        if (results[0].status === 'fulfilled') { settings = results[0].value; protect(settings); }
        if (results[1].status === 'fulfilled') entries = results[1].value;
        if (results.some(result => result.status === 'rejected')) error = LOAD_ERROR;
        loading = false;
        notify();
      })();
      return loadPromise;
    },
    clearError() { error = null; notify(); },
    async selectProvider(id: AiProviderId) {
      await changeSettings(current => { getAiProvider(id); return { ...current, selectedProvider: id }; });
    },
    async saveKey(id: AiKeyProviderId, value: string): Promise<boolean> {
      const saved = await changeSettings(current => {
        const key = value.trim();
        if (!validApiKey(key)) throw new AiError('invalid-key');
        return { ...current, selectedProvider: id, keys: { ...current.keys, [id]: key } };
      });
      if (saved) void refreshModels(id);
      return saved;
    },
    async connectOpenRouter(): Promise<boolean> {
      if (loading || saving || active) return false;
      let key: string;
      try { key = await deps.authorizeOpenRouter(); }
      catch (cause) { error = cause instanceof Error ? cause.message : 'OpenRouter sign-in could not complete.'; notify(); return false; }
      const remove = deps.registerSecret(key);
      try { return await api.saveKey('openrouter', key); } finally { remove(); }
    },
    async removeKey(id: AiKeyProviderId) {
      const removed = await changeSettings(current => {
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
    async selectModel(id: AiProviderId, model: string) {
      await changeSettings(current => {
        if (!validAiModelId(model)) throw new AiError('invalid-request');
        return { ...current, models: { ...current.models, [id]: model } };
      });
    },
    refreshModels,
    /** Consent is bound to the selected provider; switching providers turns automatic summaries off. */
    async setAutoSummarize(enabled: boolean) {
      const changed = await changeSettings(current => {
        const { autoSummarize: _previous, ...rest } = current;
        return enabled ? { ...rest, autoSummarize: current.selectedProvider } : rest;
      });
      if (changed) { autoPaused = false; notify(); }
    },
    resumeAuto() { if (autoPaused) { autoPaused = false; notify(); } },
    cancel() { controller?.abort(); },
    /** Sends one transcript to the selected provider and saves the title and summary. Never retried. */
    async generate(recording: LocalRecording, transcript: string): Promise<boolean> {
      if (loading || saving || active || !settings) return false;
      let key: string;
      try { key = recordingKey(recording); } catch { error = 'The saved recording is invalid.'; notify(); return false; }
      const provider = settings.selectedProvider;
      let sentModel: string | undefined;
      controller = new AbortController();
      active = { recordingKey: key, provider };
      const { [key]: _previous, ...rest } = failures;
      failures = rest;
      notify();
      try {
        // Without a chosen model, learn what the account offers first so an unavailable default is not sent.
        if (!validAiModelId(settings.models[provider]) && modelLists[provider]?.status !== 'ready') await refreshModels(provider);
        const model = modelFor(provider);
        sentModel = model;
        const result = await deps.summarize(await credential(provider), model, transcript, controller.signal);
        const entry = parseSummaries([{ recordingKey: key, provider, ...result,
          updatedAt: new Date((deps.now ?? Date.now)()).toISOString() }])[key];
        const next = { ...entries, [key]: entry };
        try { await deps.saveEntries(next); }
        catch { throw new Error('The summary could not be saved on this iPhone. Free some storage and try again.'); }
        entries = next;
        return true;
      } catch (cause) {
        deps.onError?.(`Summarizing ${recording.id} with ${getAiProvider(provider).name}${sentModel ? ` (${sentModel})` : ''}`, cause);
        failures = { ...failures, [key]: cause instanceof AiError || cause instanceof Error ? cause.message : 'The summary could not be created.' };
        return false;
      } finally {
        controller = null;
        active = null;
        notify();
      }
    },
    /**
     * Adopts a summary synced from iCloud when it is newer. `expected` is the local entry the sync run
     * started from; a change since then is kept and archived by a later run instead of being replaced.
     */
    async mergeSummary(recording: LocalRecording, incoming: SummaryEntry, expected?: SummaryEntry | null): Promise<void> {
      if (loading || saving || active) throw new Error('AI is busy. Try syncing again when it finishes.');
      const key = recordingKey(recording);
      let entry: SummaryEntry;
      try { entry = parseSummaries([{ ...incoming, recordingKey: key }])[key]; }
      catch { throw new Error('The iCloud summary is invalid. The saved summary was kept.'); }
      const previous = entries[key];
      if (expected !== undefined && JSON.stringify(previous ?? null) !== JSON.stringify(expected ?? null)) {
        throw new Error('The local summary changed during sync. Try syncing again to save its current version first.');
      }
      if (previous && compareSummaries(entry, previous) <= 0) return;
      saving = true;
      notify();
      try {
        const next = { ...entries, [key]: entry };
        await deps.saveEntries(next);
        entries = next;
      } catch { throw new Error('The iCloud summary could not be saved on this device. Try syncing again.'); }
      finally { saving = false; notify(); }
    },
    /** Starts the next summary when automatic summaries are on and nothing else is running. */
    async autoSummarize(candidates: SummaryCandidate[]) {
      if (loading || saving || active || !settings || autoPaused) return;
      const provider = settings.selectedProvider;
      if (settings.autoSummarize !== provider || (provider !== 'chatgpt' && !settings.keys[provider])) return;
      const next = candidates.find(candidate => !attempted.has(recordingKey(candidate.recording)));
      if (!next) return;
      attempted.add(recordingKey(next.recording));
      if (!(await api.generate(next.recording, next.transcript))) { autoPaused = true; notify(); }
    },
  };
  return api;
}
