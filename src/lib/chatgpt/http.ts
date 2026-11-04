import { ChatGPTError, ChatGPTHttpError, ISSUER, RESOURCE, type ChatGPTTokens } from './types';
import { parseTokens } from './helpers';

const MAX_RESPONSE_BYTES = 256_000;
/** Never propagate response bodies or network error strings into diagnostics. */
export async function openAIRequest(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch, require200 = false): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new ChatGPTError('ChatGPT returned an incomplete response. Please try again.');
    let body: unknown;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok || (require200 && response.status !== 200)) {
      const error = (body as { error?: unknown } | null)?.error;
      const code = typeof error === 'string' ? error : (error as { code?: unknown } | null)?.code;
      throw new ChatGPTHttpError(response.status, typeof code === 'string' && /^[a-z_]{1,80}$/.test(code) ? code : null);
    }
    return body;
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError(controller.signal.aborted ? 'ChatGPT account request timed out. Please try again.' : 'Could not reach ChatGPT. Check your internet connection and try again.');
  } finally { clearTimeout(timeout); }
}

export const tokenRequest = (params: Record<string, string>, fetcher: typeof fetch = fetch) => openAIRequest(`${ISSUER}/api/accounts/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams({ ...params, resource: RESOURCE }).toString(),
}, fetcher);

export async function refreshTokens(clientId: string, previous: ChatGPTTokens): Promise<ChatGPTTokens> {
  if (!previous.refreshToken) throw new ChatGPTError('Sign in to ChatGPT again to reconnect.');
  return parseTokens(await tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: previous.refreshToken }), Date.now(), previous);
}

export async function revokeTokens(clientId: string, refreshToken: string): Promise<void> {
  const discovery = await openAIRequest(`${ISSUER}/.well-known/openid-configuration`) as { issuer?: unknown; revocation_endpoint?: unknown } | null;
  if (discovery?.issuer !== ISSUER || typeof discovery.revocation_endpoint !== 'string') throw new ChatGPTError('ChatGPT session revocation could not be confirmed.');
  const endpoint = new URL(discovery.revocation_endpoint);
  if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new ChatGPTError('ChatGPT session revocation could not be confirmed.');
  const request = () => openAIRequest(endpoint.href, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }).toString(),
  }, fetch, true);
  try { await request(); }
  catch (error) {
    if (error instanceof ChatGPTHttpError && error.status < 500) throw error;
    await new Promise(resolve => setTimeout(resolve, 1000));
    await request();
  }
}
