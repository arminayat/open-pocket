import assert from 'node:assert/strict';
import test from 'node:test';
import { canUsePlan, issuedClientId, parseCallback, parseStore, parseTokens } from '../src/lib/chatgpt/helpers';
import { ChatGPTCancelled, ChatGPTError, DIRECT_SCOPE, type ChatGPTProfile, type ChatGPTTokens } from '../src/lib/chatgpt/types';
import { acquireOAuthSession } from '../src/lib/oauth-session';

const state = 'synthetic-state';
const clientId = 'oaiapp_synthetic';
const callback = (query: string) => `openpocket://oauth/callback?${query}`;
const now = 1_000_000;
const response = {
  id_token: 'synthetic-id', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
  token_type: 'Bearer', expires_in: 3600, scope: `openid resource.invoke ${DIRECT_SCOPE}`,
};

test('ChatGPT callback requires verified state and an issued registration, with no ambiguous fields', () => {
  const valid = `state=${state}&code=synthetic-code&client_id=${clientId}`;
  assert.deepEqual(parseCallback(callback(valid), state), { code: 'synthetic-code', clientId });
  assert.deepEqual(parseCallback(callback(`state=${state}&code=synthetic-code`), state, clientId), { code: 'synthetic-code', clientId });
  for (const query of [
    `code=synthetic-code&client_id=${clientId}`, valid.replace(state, 'wrong'),
    valid.replace('synthetic-code', ''), valid.replace(clientId, 'dynamic_agent_client'),
    valid.replace(`&client_id=${clientId}`, ''),
    ...['state', 'code', 'client_id', 'error'].map(key => `${valid}&${key}=first&${key}=second`),
  ]) assert.throws(() => parseCallback(callback(query), state), ChatGPTError);
  assert.throws(() => parseCallback(callback(valid), ''), ChatGPTError);
  assert.throws(() => parseCallback(callback(valid), state, 'oaiapp_other'), ChatGPTError);
  assert.throws(() => parseCallback(callback(valid.replace('synthetic-code', 'a'.repeat(4097))), state), ChatGPTError);
});

test('ChatGPT callback rejects a different endpoint, credentials, fragment, or port', () => {
  const query = `?state=${state}&code=synthetic-code&client_id=${clientId}`;
  for (const url of [
    'https://oauth/callback', 'openpocket://attacker/callback', 'openpocket://oauth/other',
    'openpocket://user@oauth/callback', 'openpocket://oauth:80/callback', 'not a URL',
  ]) assert.throws(() => parseCallback(`${url}${query}`, state), ChatGPTError);
  assert.throws(() => parseCallback(`openpocket://oauth/callback${query}#fragment`, state), ChatGPTError);
});

test('OAuth errors never accept codes and cancellation still requires correct state', () => {
  const denied = callback(`state=${state}&error=access_denied&code=untrusted`);
  assert.throws(() => parseCallback(denied, state), ChatGPTCancelled);
  assert.throws(() => parseCallback(denied, 'wrong'), error => error instanceof ChatGPTError && !(error instanceof ChatGPTCancelled));
  assert.throws(() => parseCallback(callback(`state=${state}&error=server_error&error_description=private-token`), state),
    error => error instanceof ChatGPTError && !error.message.includes('private-token'));
});

test('only a valid token response enables plan access; identity-only authorization remains usable', () => {
  const tokens = parseTokens(response, now);
  assert.equal(tokens.expiresAt, now + 3_600_000);
  const profile: ChatGPTProfile = { clientId, subject: 'synthetic-subject', email: null, tokens };
  assert.equal(canUsePlan(profile, now), true);
  assert.equal(canUsePlan(profile, tokens.expiresAt), false);
  assert.equal(canUsePlan({ ...profile, subject: null }, now), false);
  assert.equal(canUsePlan({ ...profile, tokens: { ...tokens, scopes: [DIRECT_SCOPE] } }, now), false);
  const identity = parseTokens({ id_token: 'synthetic-id', scope: 'openid email' }, now);
  assert.equal(identity.accessToken, null);
  assert.equal(canUsePlan({ ...profile, tokens: identity }, now), false);
  assert.deepEqual(parseTokens({ ...response, scope: `${response.scope} openid` }, now).scopes, tokens.scopes);
  for (const changed of [
    { id_token: undefined }, { access_token: '' }, { access_token: undefined }, { refresh_token: '' },
    { scope: undefined }, { token_type: 'Basic' }, { expires_in: 0 }, { expires_in: Infinity }, { expires_in: 86401 },
  ]) assert.throws(() => parseTokens({ ...response, ...changed }, now), ChatGPTError);
});

test('refresh requires both replacement credentials and retains the previously verified ID hint', () => {
  const previous = parseTokens(response, now);
  const refreshed = parseTokens({ ...response, id_token: 'unverified-new-hint', access_token: 'rotated-access', refresh_token: 'rotated-refresh' }, now + 1000, previous);
  assert.equal(refreshed.idToken, previous.idToken);
  assert.equal(refreshed.accessToken, 'rotated-access');
  assert.equal(refreshed.refreshToken, 'rotated-refresh');
  for (const changed of [{ refresh_token: undefined }, { access_token: undefined }]) {
    assert.throws(() => parseTokens({ ...response, ...changed }, now, previous), ChatGPTError);
  }
});

test('persisted registrations stay separate and malformed credentials cannot become active', () => {
  const tokens: ChatGPTTokens = parseTokens(response, now);
  const profile = { clientId, subject: 'synthetic-subject', email: 'same@example.test', tokens };
  const store = {
    hostId: 'urn:uuid:12345678-1234-4234-8234-123456789abc',
    profiles: [profile, { ...profile, clientId: 'oaiapp_second', subject: 'second-subject' }], activeClientId: clientId,
  };
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  for (const changed of [
    { hostId: `urn:uuid:${'-'.repeat(36)}` }, { hostId: 'urn:uuid:12345678-1234-1234-8234-123456789abc' },
    { profiles: [profile, profile] }, { activeClientId: 'oaiapp_missing' },
    { profiles: [{ ...profile, tokens: null }] }, { profiles: [{ ...profile, subject: null }] },
    { profiles: [{ ...profile, tokens: { ...tokens, accessToken: 42 } }] },
  ]) assert.throws(() => parseStore(JSON.stringify({ ...store, ...changed })));
  assert.equal(issuedClientId('dynamic_agent_client'), false);
  assert.equal(issuedClientId('oaiapp_'), false);
});

test('Pocket and ChatGPT share an exclusive OAuth session and release is idempotent', () => {
  const releaseFirst = acquireOAuthSession();
  assert.throws(acquireOAuthSession, /Another sign-in/);
  releaseFirst();
  const releaseSecond = acquireOAuthSession();
  releaseFirst();
  assert.throws(acquireOAuthSession, /Another sign-in/);
  releaseSecond();
  acquireOAuthSession()();
});
