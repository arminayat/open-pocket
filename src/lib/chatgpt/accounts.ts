import { canUsePlan } from './helpers';
import { ChatGPTCancelled, ChatGPTError, unusableRefresh, type ChatGPTIdentity, type ChatGPTProfile, type ChatGPTProfileView, type ChatGPTStore, type ChatGPTTokens } from './types';

interface AccountDependencies {
  load(): Promise<ChatGPTStore | null>;
  save(store: ChatGPTStore): Promise<void>;
  newHostId(): string;
  authorize(hostId: string, profile: ChatGPTProfile | undefined,
    registered: (clientId: string) => Promise<void>): Promise<{ clientId: string; identity: ChatGPTIdentity; tokens: ChatGPTTokens }>;
  refresh(clientId: string, tokens: ChatGPTTokens): Promise<ChatGPTTokens>;
  revoke(clientId: string, refreshToken: string): Promise<void>;
  now?(): number;
}

/** One owner serializes Keychain updates, OAuth and rotating refresh tokens. Tokens never enter UI state. */
export function createChatGPTAccounts(deps: AccountDependencies) {
  let store: ChatGPTStore | null = null;
  let loading = true;
  let busy = false;
  let error: string | null = null;
  let notice: string | null = null;
  let loadPromise: Promise<void> | undefined;
  let pendingPersistence = false;
  const signingOut = new Set<string>();
  const listeners = new Set<() => void>();
  const now = deps.now ?? Date.now;
  const notify = () => { for (const listener of listeners) listener(); };
  const requireStore = () => {
    if (!store) throw new ChatGPTError('ChatGPT accounts could not be loaded. Restart OpenPocket to try again.');
    return store;
  };
  const save = async (next: ChatGPTStore) => {
    try { await deps.save(next); } catch { throw new ChatGPTError('ChatGPT account could not be saved securely. Please try again.'); }
    store = next;
    pendingPersistence = false;
    notify();
  };
  const replace = (profile: ChatGPTProfile, activeClientId = requireStore().activeClientId) => ({
    ...requireStore(), activeClientId,
    profiles: requireStore().profiles.some(item => item.clientId === profile.clientId)
      ? requireStore().profiles.map(item => item.clientId === profile.clientId ? profile : item)
      : [...requireStore().profiles, profile],
  });
  const run = async (work: () => Promise<void>, quiet = false) => {
    if (busy || loading) return;
    busy = true;
    if (!quiet) { error = null; notice = null; }
    notify();
    try { await work(); if (quiet) error = null; }
    catch (cause) {
      if (!(cause instanceof ChatGPTCancelled)) {
        error = cause instanceof ChatGPTError ? cause.message : 'ChatGPT connection could not complete. Please try again.';
      }
    } finally { busy = false; notify(); }
  };

  const api = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot() {
      const profiles: ChatGPTProfileView[] = (store?.profiles ?? []).map((profile, index) => ({
        clientId: profile.clientId,
        label: `${profile.email || 'ChatGPT account'} · ${index + 1}`,
        active: profile.clientId === store?.activeClientId && !signingOut.has(profile.clientId),
        signedIn: Boolean(profile.subject && profile.tokens),
        planEnabled: !signingOut.has(profile.clientId) && canUsePlan(profile, now()),
        needsReconnect: signingOut.has(profile.clientId) || Boolean(profile.tokens?.accessToken && profile.tokens.expiresAt <= now()),
      }));
      const activeClientId = store?.activeClientId;
      return { loading, busy, error, notice, profiles, activeClientId: activeClientId && !signingOut.has(activeClientId) ? activeClientId : null };
    },
    load() {
      loadPromise ??= (async () => {
        try {
          store = await deps.load();
          if (!store) await save({ hostId: deps.newHostId(), profiles: [], activeClientId: null });
        } catch {
          store = null;
          error = 'ChatGPT accounts could not be loaded securely. Restart OpenPocket to try again.';
        } finally { loading = false; notify(); }
      })();
      return loadPromise;
    },
    clearError() { error = null; notify(); },
    connect(clientId?: string) {
      return run(async () => {
        const current = requireStore();
        const selected = clientId ? current.profiles.find(profile => profile.clientId === clientId) : undefined;
        if (clientId && !selected) throw new ChatGPTError('Choose a saved ChatGPT account or add a new one.');
        const result = await deps.authorize(current.hostId, selected, async issued => {
          if (selected && issued !== selected.clientId) throw new ChatGPTError('ChatGPT returned a different account registration.');
          if (!requireStore().profiles.some(profile => profile.clientId === issued)) {
            // Retain the issued ID even if exchange fails, so the next attempt reuses registration.
            await save({ ...requireStore(), profiles: [...requireStore().profiles, { clientId: issued, subject: null, email: null, tokens: null }] });
          }
        });
        const existing = requireStore().profiles.find(profile => profile.clientId === result.clientId);
        if ((selected && result.clientId !== selected.clientId) || (existing?.subject && existing.subject !== result.identity.subject)) {
          throw new ChatGPTError('ChatGPT returned a different account. Add it as a new account instead.');
        }
        const profile: ChatGPTProfile = { clientId: result.clientId, ...result.identity, tokens: result.tokens };
        await save(replace(profile, profile.clientId));
        signingOut.delete(profile.clientId);
        notice = canUsePlan(profile, now())
          ? 'ChatGPT is connected. AI summaries can use your ChatGPT plan and its limits. Manage access and usage in ChatGPT Settings. No recordings were uploaded.'
          : 'Signed in to ChatGPT. Plan access is not enabled. You can enable it here when you are ready.';
      });
    },
    signOut(clientId: string) {
      return run(async () => {
        const profile = requireStore().profiles.find(item => item.clientId === clientId);
        if (!profile?.tokens) return;
        signingOut.add(clientId);
        let revoked = !profile.tokens.refreshToken;
        if (profile.tokens.refreshToken) {
          try { await deps.revoke(clientId, profile.tokens.refreshToken); revoked = true; } catch { /* Explicit local sign-out still proceeds. */ }
        }
        const next = replace({ ...profile, tokens: null }, requireStore().activeClientId === clientId ? null : requireStore().activeClientId);
        // Keep the sign-out action retryable if Keychain fails; this account cannot refresh meanwhile.
        await save(next);
        signingOut.delete(clientId);
        notice = revoked ? 'Signed out of ChatGPT on this iPhone.'
          : 'Signed out on this iPhone. Remote sign-out could not be confirmed. Disconnect OpenPocket in ChatGPT Settings to end its access.';
      });
    },
    refreshActive() {
      const active = store?.profiles.find(item => item.clientId === store?.activeClientId);
      if (!pendingPersistence && (!active?.tokens?.refreshToken || signingOut.has(active.clientId) || active.tokens.expiresAt > now() + 60_000)) return Promise.resolve();
      return run(async () => {
        // Retry a failed Keychain replacement before rotating again, including terminal-token removal.
        if (pendingPersistence) await save(requireStore());
        const profile = requireStore().profiles.find(item => item.clientId === requireStore().activeClientId);
        if (!profile?.tokens?.refreshToken || signingOut.has(profile.clientId) || profile.tokens.expiresAt > now() + 60_000) return;
        try {
          const tokens = await deps.refresh(profile.clientId, profile.tokens);
          const next = replace({ ...profile, tokens });
          // Do not replay a rotated refresh token if Keychain persistence fails.
          store = next;
          pendingPersistence = true;
          await save(next);
        } catch (cause) {
          if (unusableRefresh(cause)) {
            const next = replace({ ...profile, tokens: null }, null);
            store = next;
            pendingPersistence = true;
            await save(next);
            throw new ChatGPTError('Your ChatGPT session ended. Sign in again to reconnect.');
          }
          throw cause;
        }
      }, true);
    },
    /** The active account's access token for plan-billed AI requests, renewed first; null without plan access. */
    async planToken(): Promise<string | null> {
      await api.refreshActive();
      const profile = store?.profiles.find(item => item.clientId === store?.activeClientId);
      return profile && !signingOut.has(profile.clientId) && canUsePlan(profile, now()) ? profile.tokens!.accessToken : null;
    },
  };
  return api;
}
