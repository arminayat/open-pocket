import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveCandidateKey, parseAccountInfo, parseOAuthMetadata, parseRegistration, parseRpcResponse,
  registrationBody, validateAuthorizationResult, validateDeviceKey,
} from '../src/lib/account/helpers';

const ownerId = 'demoUserABC12345abcdefghijkl';

test('vendor-compatible candidate derivation is deterministic but rejects unsafe protocol text', () => {
  assert.equal(deriveCandidateKey(ownerId), 'demoUserABC12345');
  assert.equal(deriveCandidateKey('short'), 'short00000000000');
  assert.equal(validateDeviceKey(' demoUserABC12345\n'), 'demoUserABC12345');
  for (const value of ['', 'user with spaces', '日'.repeat(16), 'a'.repeat(129), '12345678&abcdefg']) {
    assert.throws(() => deriveCandidateKey(value));
  }
  for (const value of ['too-short', 'a'.repeat(17), '12345678&abcdefg', 'abcdefgh ijklmno']) {
    assert.throws(() => validateDeviceKey(value));
  }
});

test('account tool parses actual structured and JSON text envelopes without guessing other identities', () => {
  const info = { userId: ownerId, email: 'owner@example.test' };
  for (const result of [
    { structuredContent: info },
    { structuredContent: { success: true, data: info } },
    { content: [{ type: 'text', text: JSON.stringify({ success: true, data: info }) }] },
  ]) {
    assert.deepEqual(parseAccountInfo(result), { userId: ownerId, accountLabel: 'owner@example.test' });
  }
  for (const result of [
    { isError: true, structuredContent: info },
    { structuredContent: { success: false, data: info } },
    { content: [{ type: 'text', text: 'your account id is demoUserABC12345' }] },
    { structuredContent: { email: 'owner@example.test', uid: ownerId } },
  ]) assert.throws(() => parseAccountInfo(result));
});

test('JSON and SSE parsing matches request ids and ignores notifications', () => {
  const result = { structuredContent: { userId: ownerId } };
  const json = JSON.stringify({ jsonrpc: '2.0', id: 7, result });
  assert.deepEqual(parseRpcResponse(json, 'application/json', 7), result);
  assert.equal(parseRpcResponse(json, 'application/json', 8), undefined);
  const sse = `: keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"ping"}\r\n\r\n` +
    `event: message\r\ndata: ${json}\r\n\r\n`;
  assert.deepEqual(parseRpcResponse(sse, 'text/event-stream', 7), result);
  assert.equal(parseRpcResponse('data: {"jsonrpc":', 'text/event-stream', 7), undefined);
  assert.throws(() => parseRpcResponse('{"jsonrpc":"2.0","id":7,"error":{"message":"private"}}', 'application/json', 7),
    (error: unknown) => error instanceof Error && !error.message.includes('private'));
});

const metadata = {
  authorization_endpoint: 'https://production.heypocketai.com/oauth/authorize',
  token_endpoint: 'https://production.heypocketai.com/oauth/token',
  registration_endpoint: 'https://production.heypocketai.com/oauth/register',
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
};

test('OAuth requires S256 and public native registration on trusted HTTPS hosts', () => {
  assert.equal(parseOAuthMetadata(metadata).tokenEndpoint, metadata.token_endpoint);
  for (const changed of [
    { code_challenge_methods_supported: ['plain'] },
    { token_endpoint_auth_methods_supported: ['client_secret_basic'] },
    { registration_endpoint: undefined },
    { token_endpoint: 'https://production.heypocketai.com.attacker.test/token' },
    { token_endpoint: 'http://production.heypocketai.com/oauth/token' },
    { token_endpoint: 'https://user@production.heypocketai.com/oauth/token' },
  ]) assert.throws(() => parseOAuthMetadata({ ...metadata, ...changed }));
  assert.deepEqual(registrationBody().redirect_uris, ['openpocket://oauth/callback']);
  assert.equal(registrationBody().token_endpoint_auth_method, 'none');
  assert.equal(parseRegistration({ client_id: 'synthetic-client', redirect_uris: registrationBody().redirect_uris }), 'synthetic-client');
  assert.throws(() => parseRegistration({ client_id: 'synthetic-client', client_secret: 'must-not-use' }));
  assert.throws(() => parseRegistration({ client_id: 'synthetic-client', redirect_uris: ['https://example.test'] }));
});

test('authorization callback fails closed when state is missing or mismatched', () => {
  assert.equal(validateAuthorizationResult('synthetic-state', { state: 'synthetic-state', code: 'synthetic-code' }), 'synthetic-code');
  assert.throws(() => validateAuthorizationResult('synthetic-state', { code: 'synthetic-code' }));
  assert.throws(() => validateAuthorizationResult('synthetic-state', { state: 'wrong', code: 'synthetic-code' }));
  assert.throws(() => validateAuthorizationResult('', { state: '', code: 'synthetic-code' }));
});
