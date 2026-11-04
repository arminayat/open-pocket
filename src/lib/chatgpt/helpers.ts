import { ChatGPTCancelled, ChatGPTError, DIRECT_SCOPE, type ChatGPTProfile, type ChatGPTStore, type ChatGPTTokens } from './types';

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const token = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 65_536;
export const issuedClientId = (value: unknown): value is string =>
  typeof value === 'string' && /^oaiapp_[A-Za-z0-9_-]{1,256}$/.test(value);

/** Reject ambiguous callbacks before using any code or issued client ID. */
export function parseCallback(url: string, expectedState: string, previousClientId?: string) {
  let callback: URL;
  try { callback = new URL(url); } catch { throw new ChatGPTError('ChatGPT sign-in returned an invalid callback.'); }
  if (callback.protocol !== 'openpocket:' || callback.hostname !== 'oauth' || callback.pathname !== '/callback' || callback.hash || callback.username || callback.password || callback.port) {
    throw new ChatGPTError('ChatGPT sign-in returned an invalid callback.');
  }
  const params = callback.searchParams;
  for (const key of ['state', 'code', 'client_id', 'error']) {
    if (params.getAll(key).length > 1) throw new ChatGPTError('ChatGPT sign-in returned an ambiguous callback.');
  }
  if (!expectedState || params.get('state') !== expectedState) throw new ChatGPTError('ChatGPT sign-in could not be verified. Please start again.');
  if (params.has('error')) {
    if (params.get('error') === 'access_denied') throw new ChatGPTCancelled('ChatGPT sign-in was cancelled.');
    throw new ChatGPTError('ChatGPT sign-in could not complete. Please try again.');
  }
  const code = params.get('code');
  const clientId = params.get('client_id') ?? previousClientId;
  if (!code || code.length > 4096 || !issuedClientId(clientId) || (previousClientId && clientId !== previousClientId)) {
    throw new ChatGPTError('ChatGPT did not complete this account registration. Please sign in again.');
  }
  return { code, clientId };
}

/** Only the token response grants plan permission; callback scopes are never trusted. */
export function parseTokens(value: unknown, now: number, previous?: ChatGPTTokens): ChatGPTTokens {
  const data = object(value);
  if (!data || typeof data.scope !== 'string' || data.scope.length > 4096 ||
      (!previous && !token(data.id_token))) throw new ChatGPTError('ChatGPT returned incomplete authorization. Please sign in again.');
  const scopes = [...new Set(data.scope.split(/\s+/).filter(Boolean))];
  const hasAccess = token(data.access_token);
  if ((data.access_token != null && !hasAccess) ||
      (data.refresh_token != null && !token(data.refresh_token)) ||
      (hasAccess && (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
        typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400)) ||
      (scopes.includes(DIRECT_SCOPE) && !hasAccess) ||
      (scopes.includes('offline_access') && !token(data.refresh_token)) ||
      (previous && (!hasAccess || !token(data.refresh_token)))) {
    throw new ChatGPTError('ChatGPT returned incomplete authorization. Please sign in again.');
  }
  return {
    accessToken: hasAccess ? data.access_token as string : null,
    refreshToken: token(data.refresh_token) ? data.refresh_token : null,
    // An expired, previously verified ID token is still a valid reauthorization hint.
    idToken: previous?.idToken ?? data.id_token as string,
    scopes, expiresAt: hasAccess ? now + (data.expires_in as number) * 1000 : now,
  };
}

export function canUsePlan(profile: ChatGPTProfile, now = Date.now()): boolean {
  return Boolean(profile.subject && profile.tokens?.accessToken && profile.tokens.expiresAt > now &&
    profile.tokens.scopes.includes(DIRECT_SCOPE) && profile.tokens.scopes.includes('resource.invoke'));
}

/** Keychain is trusted storage, but corrupt or obsolete data must not become an active session. */
export function parseStore(text: string): ChatGPTStore {
  const data = object(JSON.parse(text));
  if (!data || typeof data.hostId !== 'string' || !/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.hostId) || !Array.isArray(data.profiles)) throw new Error('Invalid ChatGPT store');
  const ids = new Set<string>();
  const profiles = data.profiles.map((item): ChatGPTProfile => {
    const profile = object(item);
    if (!profile || !issuedClientId(profile.clientId) || ids.has(profile.clientId) ||
        !(profile.subject === null || token(profile.subject)) ||
        !(profile.email === null || (typeof profile.email === 'string' && profile.email.length <= 320))) throw new Error('Invalid ChatGPT profile');
    ids.add(profile.clientId);
    let tokens: ChatGPTTokens | null = null;
    if (profile.tokens !== null) {
      const value = object(profile.tokens);
      if (!profile.subject || !value || !token(value.idToken) ||
          !(value.accessToken === null || token(value.accessToken)) ||
          !(value.refreshToken === null || token(value.refreshToken)) ||
          !Array.isArray(value.scopes) || !value.scopes.every(scope => typeof scope === 'string') ||
          typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) throw new Error('Invalid ChatGPT tokens');
      tokens = value as unknown as ChatGPTTokens;
    }
    return { clientId: profile.clientId, subject: profile.subject as string | null, email: profile.email as string | null, tokens };
  });
  if (data.activeClientId !== null && (!issuedClientId(data.activeClientId) || !profiles.some(profile => profile.clientId === data.activeClientId && profile.subject && profile.tokens))) throw new Error('Invalid active ChatGPT account');
  return { hostId: data.hostId, profiles, activeClientId: data.activeClientId as string | null };
}
