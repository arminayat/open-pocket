import type { ICloudSyncResult } from './types';

export interface ICloudPreference { enabled: boolean; accountId: string | null }
export interface ICloudAvailability { available: boolean; accountId: string | null; reason: string }
export const ICLOUD_OFF: ICloudPreference = { enabled: false, accountId: null };

export function parseICloudPreference(value: unknown): ICloudPreference {
  if (!value || typeof value !== 'object') throw new Error('Invalid iCloud preference.');
  const item = value as Partial<ICloudPreference>;
  if (item.enabled === false && item.accountId === null) return { ...ICLOUD_OFF };
  if (item.enabled === true && typeof item.accountId === 'string' && /^[a-f0-9]{64}$/.test(item.accountId)) {
    return { enabled: true, accountId: item.accountId };
  }
  throw new Error('Invalid iCloud preference.');
}

interface Dependencies {
  loadPreference(): Promise<ICloudPreference>;
  savePreference(value: ICloudPreference): Promise<void>;
  status(): Promise<ICloudAvailability>;
  open(accountId: string): Promise<string>;
  close(): void;
  reconcile(session: string, checkActive: () => void, onStage: (stage: string) => void): Promise<ICloudSyncResult>;
}

/** Owns account-bound consent and revokes native writes synchronously on opt-out. */
export function createICloudController(deps: Dependencies) {
  let preference = { ...ICLOUD_OFF };
  let loading = true;
  let enabled = false;
  let saving = false;
  let preferenceQueue = Promise.resolve();
  let preferenceWrites = 0;
  let preferenceIntent = 0;
  let busy = false;
  let foreground = true;
  let epoch = 0;
  let session: string | null = null;
  let availability: ICloudAvailability | null = null;
  let needsConfirmation = false;
  let unsavedOptOut = false;
  let error: string | null = null;
  let stage: string | null = null;
  let result: ICloudSyncResult | null = null;
  let lastCheckedAt: string | null = null;
  let loadingPromise: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const revoke = () => { epoch += 1; session = null; deps.close(); };

  async function sync(): Promise<void> {
    if (loading || saving || busy || !enabled || !foreground || unsavedOptOut) return;
    busy = true;
    error = null;
    stage = 'Checking iCloud availability';
    const generation = epoch;
    const checkActive = () => {
      if (generation !== epoch || !enabled || !foreground) throw new Error('iCloud sync paused.');
    };
    notify();
    try {
      const status = await deps.status();
      checkActive();
      availability = status;
      if (status.accountId && status.accountId !== preference.accountId) {
        revoke();
        enabled = false;
        needsConfirmation = true;
        result = null;
        lastCheckedAt = null;
        error = 'Your iCloud account changed. Turn sync on again to copy this library to the current account.';
        return;
      }
      if (!status.available || !status.accountId) {
        revoke();
        error = status.reason || 'Sign in to iCloud and enable iCloud Drive in Apple Settings.';
        return;
      }
      if (!session) {
        const opened = await deps.open(status.accountId);
        checkActive();
        session = opened;
      }
      checkActive();
      const reconciled = await deps.reconcile(session, checkActive, next => {
        checkActive(); stage = next; notify();
      });
      checkActive();
      result = reconciled;
      lastCheckedAt = new Date().toISOString();
      if (result.errors) error = 'Some files could not be synced. Existing recordings and text were kept. Try again.';
    } catch {
      if (generation === epoch && enabled && foreground) {
        revoke();
        error = 'iCloud sync could not finish. Check iCloud Drive and available storage, then try again.';
      }
    } finally { busy = false; stage = null; notify(); }
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot() { return { loading, enabled, saving, busy, availability, needsConfirmation, unsavedOptOut, error, stage, result, lastCheckedAt }; },
    load() {
      loadingPromise ??= (async () => {
        const intent = preferenceIntent;
        try {
          const loaded = parseICloudPreference(await deps.loadPreference());
          if (intent === 0 && preferenceIntent === 0) { preference = loaded; enabled = preference.enabled; }
        } catch {
          if (intent === 0 && preferenceIntent === 0) error = 'Could not read iCloud settings. Sync is off. Turn it on to save a new preference.';
        }
        try { availability = await deps.status(); } catch { /* Availability is checked again before enabling. */ }
        loading = false;
        notify();
      })();
      return loadingPromise;
    },
    setEnabled(value: boolean): Promise<void> {
      const intent = ++preferenceIntent;
      // Off always revokes writes immediately, including work waiting on a native queue.
      if (!value) { enabled = false; revoke(); }
      preferenceWrites += 1;
      saving = true;
      error = null;
      notify();
      const operation = preferenceQueue.then(async () => {
      try {
        if (!value) {
          preference = { ...ICLOUD_OFF };
          await deps.savePreference(preference);
          unsavedOptOut = false;
          needsConfirmation = false;
          if (intent === preferenceIntent) error = null;
        } else {
          if (intent !== preferenceIntent) return;
          const status = await deps.status();
          if (intent !== preferenceIntent) return;
          availability = status;
          if (!status.available || !status.accountId) {
            error = status.reason || 'Sign in to iCloud and enable iCloud Drive in Apple Settings.';
            return;
          }
          const next = parseICloudPreference({ enabled: true, accountId: status.accountId });
          await deps.savePreference(next);
          // Persisted consent survives backgrounding; only a newer user choice supersedes it.
          // foreground and session epoch still prevent work until a fresh account check succeeds.
          if (intent !== preferenceIntent) return;
          preference = next;
          enabled = true;
          unsavedOptOut = false;
          needsConfirmation = false;
          error = null;
        }
      } catch {
        if (!value) {
          unsavedOptOut = true;
          error = 'Sync is paused, but the Off setting could not be saved. Retry saving Off before closing Open Pocket.';
        } else { enabled = false; error = 'Could not enable iCloud sync. Check iCloud Drive and try again.'; }
      } finally { preferenceWrites -= 1; saving = preferenceWrites > 0; notify(); }
      });
      preferenceQueue = operation;
      return operation;
    },
    sync,
    setForeground(value: boolean) {
      foreground = value;
      if (!value) revoke();
    },
    close() { foreground = false; revoke(); },
  };
}
