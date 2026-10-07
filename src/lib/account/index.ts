import { AuthRequest, CodeChallengeMethod, ResponseType } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { diagnostics, safeErrorMessage } from '../diagnostics';
import {
  deriveCandidateKey, DISCOVERY_URL, MCP_URL, objectValue, OAUTH_REDIRECT_URI,
  parseOAuthMetadata, parseRegistration, registrationBody, validateAuthorizationResult,
} from './helpers';
import { PocketHttpError, readPocketAccount, requestJson } from './http';

export { deriveCandidateKey, validateDeviceKey } from './helpers';

export interface PocketAccountConnection {
  key: string;
  source: 'oauth' | 'api-key';
  accountLabel: string;
}

let signingIn = false;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

async function accountConnection(credential: string,
  source: PocketAccountConnection['source']): Promise<PocketAccountConnection> {
  const forgetCredential = diagnostics.registerSecret(credential);
  try {
    diagnostics.log('account', 'Reading account identity for a candidate device key.', { source });
    const account = await readPocketAccount(credential);
    const forgetIdentity = diagnostics.registerSecret(account.userId);
    try {
      const key = deriveCandidateKey(account.userId);
      diagnostics.log('account', 'Account identity received. Device authentication is still required.', { source });
      return { key, source, accountLabel: account.accountLabel };
    } finally { forgetIdentity(); account.userId = ''; }
  } finally { forgetCredential(); credential = ''; }
}

export async function connectWithApiKey(apiKey: string): Promise<PocketAccountConnection> {
  let credential = apiKey.trim();
  if (!/^pk_[A-Za-z0-9_-]+$/.test(credential) || credential.length > 4096) {
    throw new Error('Enter a Pocket API key starting with pk_. Find it in Pocket Settings → Developer → API Keys.');
  }
  try { return await accountConnection(credential, 'api-key'); }
  catch (error) { throw new Error(safeErrorMessage(error)); }
  finally { credential = ''; }
}

export async function signInToPocket(): Promise<PocketAccountConnection> {
  if (signingIn) throw new Error('Pocket sign-in is already open. Finish or close it before trying again.');
  signingIn = true;
  let token = '';
  let forgetEphemeral = () => {};
  try {
    diagnostics.log('account', 'Preparing Pocket account sign-in.');
    const metadata = parseOAuthMetadata(await requestJson(DISCOVERY_URL));
    let registered: unknown;
    try {
      registered = await requestJson(metadata.registrationEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationBody()),
      });
    } catch (error) {
      if (error instanceof PocketHttpError) {
        throw new Error('Pocket did not accept registration for this app. Use an API key or device key instead.');
      }
      throw error;
    }
    const clientId = parseRegistration(registered);
    const request = new AuthRequest({
      clientId, redirectUri: OAUTH_REDIRECT_URI, responseType: ResponseType.Code,
      scopes: ['mcp:read'], usePKCE: true, codeChallengeMethod: CodeChallengeMethod.S256,
      extraParams: { resource: MCP_URL },
    });
    await request.makeAuthUrlAsync(metadata);
    const cleanups = [diagnostics.registerSecret(clientId), diagnostics.registerSecret(request.state)];
    if (request.codeVerifier) cleanups.push(diagnostics.registerSecret(request.codeVerifier));
    forgetEphemeral = () => { for (const cleanup of cleanups) cleanup(); request.codeVerifier = undefined; };
    diagnostics.log('account', 'Opening Pocket’s secure sign-in page.');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      request.promptAsync(metadata),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          try { WebBrowser.dismissAuthSession(); } catch { /* Native session may have already closed. */ }
          reject(new Error('Pocket sign-in timed out. Try again or use an API key.'));
        }, SIGN_IN_TIMEOUT_MS);
      }),
    ]).finally(() => { if (timeout) clearTimeout(timeout); });
    if (result.type === 'cancel' || result.type === 'dismiss') throw new Error('Pocket sign-in was cancelled.');
    if (result.type !== 'success') throw new Error('Pocket sign-in could not complete. Try an API key or device key instead.');
    const code = validateAuthorizationResult(request.state, result.params);
    const forgetCode = diagnostics.registerSecret(code);
    try {
      if (!request.codeVerifier) throw new Error('Pocket sign-in verification was incomplete. Start again.');
      const tokens = objectValue(await requestJson(metadata.tokenEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', client_id: clientId, code,
          redirect_uri: OAUTH_REDIRECT_URI, code_verifier: request.codeVerifier, resource: MCP_URL,
        }).toString(),
      }));
      if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token ||
          (typeof tokens.token_type === 'string' && tokens.token_type.toLowerCase() !== 'bearer')) {
        throw new Error('Pocket did not return valid authorization. Try signing in again.');
      }
      token = tokens.access_token;
      tokens.access_token = ''; tokens.refresh_token = ''; tokens.id_token = '';
    } finally { forgetCode(); result.params.code = ''; }
    return await accountConnection(token, 'oauth');
  } catch (error) {
    const message = safeErrorMessage(error);
    diagnostics.log('account', message);
    throw new Error(message);
  } finally {
    token = ''; forgetEphemeral(); signingIn = false;
  }
}
