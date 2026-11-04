import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import * as WebBrowser from 'expo-web-browser';
import { PocketOAuthLoopback } from '../../../modules/pocket-wifi';
import { APP_CALLBACK_URI, loopbackRedirectUri } from '../account/helpers';
import { diagnostics } from '../diagnostics';
import { acquireOAuthSession } from '../oauth-session';
import { validApiKey } from '../transcription/state';
import { aiRequest, parseAiJson } from './request';

class OpenRouterSignInError extends Error {}
const base64url = (value: string) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * OpenRouter PKCE: the user approves in a system browser sheet and OpenRouter issues a key billed to
 * their credits. The documented localhost callback is relayed back to the app by the existing loopback.
 */
export async function authorizeOpenRouter(): Promise<string> {
  let release: () => void;
  try { release = acquireOAuthSession(); } catch { throw new OpenRouterSignInError('Another sign-in is open. Finish or close it first.'); }
  const cleanups: (() => void)[] = [];
  try {
    const callback = loopbackRedirectUri(await PocketOAuthLoopback.start());
    // 96 hex characters: within PKCE's 43–128 unreserved-character range.
    const verifier = Array.from(Crypto.getRandomBytes(48), byte => byte.toString(16).padStart(2, '0')).join('');
    const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 }));
    const state = Crypto.randomUUID();
    cleanups.push(diagnostics.registerSecret(verifier), diagnostics.registerSecret(state));
    const url = `https://openrouter.ai/auth?${new URLSearchParams({ callback_url: callback, code_challenge: challenge,
      code_challenge_method: 'S256', state, key_label: 'OpenPocket' })}`;
    const session = await WebBrowser.openAuthSessionAsync(url, APP_CALLBACK_URI);
    if (session.type !== 'success') throw new OpenRouterSignInError('OpenRouter sign-in was cancelled.');
    const params = new URL(session.url).searchParams;
    const code = params.get('code');
    // OpenRouter echoes `state` when given; reject a different one, and require a plain code.
    if ((params.has('state') && params.get('state') !== state) || !code || !/^[\w.-]{1,512}$/.test(code)) {
      throw new OpenRouterSignInError('OpenRouter returned an unexpected sign-in response. Please try again.');
    }
    cleanups.push(diagnostics.registerSecret(code));
    const value = parseAiJson(await aiRequest('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    }, new AbortController().signal, expoFetch as typeof fetch)) as { key?: unknown };
    if (!validApiKey(value.key)) throw new OpenRouterSignInError('OpenRouter did not return a usable key. Please try again.');
    return value.key;
  } catch (error) {
    if (error instanceof OpenRouterSignInError) throw error;
    throw new OpenRouterSignInError('OpenRouter sign-in could not complete. You can paste an API key instead.');
  } finally {
    await PocketOAuthLoopback.stop().catch(() => {});
    cleanups.forEach(cleanup => cleanup());
    release();
  }
}
