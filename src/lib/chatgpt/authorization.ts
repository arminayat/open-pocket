import { AuthRequest, CodeChallengeMethod, ResponseType } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { ChatGPTIdentity, PocketOAuthLoopback } from '../../../modules/pocket-wifi';
import { APP_CALLBACK_URI, loopbackRedirectUri } from '../account/helpers';
import { acquireOAuthSession } from '../oauth-session';
import { diagnostics } from '../diagnostics';
import { parseCallback, parseTokens } from './helpers';
import { openAIRequest, tokenRequest } from './http';
import { ChatGPTCancelled, ChatGPTError, DIRECT_SCOPE, ISSUER, RESOURCE, SCOPES, type ChatGPTProfile } from './types';

export async function authorizeChatGPT(hostId: string, profile: ChatGPTProfile | undefined,
  registered: (clientId: string) => Promise<void>) {
  let release: () => void;
  try { release = acquireOAuthSession(); } catch { throw new ChatGPTError('Another sign-in is open. Finish or close it first.'); }
  const cleanups: (() => void)[] = [];
  let request: AuthRequest | undefined;
  try {
    const redirectUri = loopbackRedirectUri(await PocketOAuthLoopback.start());
    const nonce = Crypto.randomUUID();
    request = new AuthRequest({
      clientId: profile?.clientId ?? 'dynamic_agent_client', redirectUri,
      responseType: ResponseType.Code, scopes: SCOPES, state: Crypto.randomUUID(),
      usePKCE: true, codeChallengeMethod: CodeChallengeMethod.S256,
      extraParams: {
        nonce, resource: RESOURCE, ext_agent_host_id: hostId,
        ...(!profile ? { agent_name_hint: 'OpenPocket' } : {}),
        ...(profile?.tokens?.idToken ? { id_token_hint: profile.tokens.idToken } : {}),
        ...(profile?.email ? { login_hint: profile.email } : {}),
        ...(profile?.tokens && !profile.tokens.scopes.includes(DIRECT_SCOPE) ? { prompt: 'consent' } : {}),
      },
    });
    const url = await request.makeAuthUrlAsync({ authorizationEndpoint: `${ISSUER}/api/accounts/authorize` });
    for (const value of [url, hostId, request.state, nonce, request.codeVerifier ?? '', profile?.tokens?.idToken ?? '']) cleanups.push(diagnostics.registerSecret(value));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const session = await Promise.race([
      WebBrowser.openAuthSessionAsync(url, APP_CALLBACK_URI),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          try { WebBrowser.dismissAuthSession(); } catch { /* Already dismissed. */ }
          reject(new ChatGPTError('ChatGPT sign-in timed out. Please try again.'));
        }, 5 * 60_000);
      }),
    ]).finally(() => { if (timeout) clearTimeout(timeout); });
    if (session.type === 'cancel' || session.type === 'dismiss') throw new ChatGPTCancelled();
    if (session.type !== 'success') throw new ChatGPTError('ChatGPT sign-in could not complete. Please try again.');
    const callback = parseCallback(session.url, request.state, profile?.clientId);
    cleanups.push(diagnostics.registerSecret(callback.code), diagnostics.registerSecret(callback.clientId));
    await registered(callback.clientId);
    if (!request.codeVerifier) throw new ChatGPTError('ChatGPT sign-in verification was incomplete. Please try again.');
    const tokens = parseTokens(await tokenRequest({
      grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code,
      code_verifier: request.codeVerifier, redirect_uri: redirectUri,
    }), Date.now());
    for (const value of [tokens.accessToken, tokens.refreshToken, tokens.idToken]) if (value) cleanups.push(diagnostics.registerSecret(value));
    const jwks = await openAIRequest(`${ISSUER}/.well-known/jwks.json`);
    let identity;
    try { identity = await ChatGPTIdentity.verify(tokens.idToken, JSON.stringify(jwks), callback.clientId, nonce); }
    catch { throw new ChatGPTError('ChatGPT account identity could not be verified. Please sign in again.'); }
    return { clientId: callback.clientId, tokens, identity };
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError('ChatGPT sign-in could not complete. Use the latest OpenPocket iPhone build and try again.');
  } finally {
    if (request) { request.codeVerifier = undefined; request.url = null; }
    await PocketOAuthLoopback.stop().catch(() => {});
    cleanups.forEach(cleanup => cleanup());
    release();
  }
}
