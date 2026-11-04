import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnostics } from '../src/lib/diagnostics';

test('diagnostics redact registered device key, AP password and identifiers everywhere', () => {
  const diagnostics = createDiagnostics();
  const key = 'demoUserABC12345';
  diagnostics.registerSecret(key);
  diagnostics.log('bluetooth', `APP&SK&${key}; wifi ${key.slice(0, 8)}`, {
    error: `${key} owner@example.test PKT01_GREY_DEMO 01:23:45:67:89:AB`,
    receivedBytes: 4000, password: 'unlisted-value', nested: { token: 'private' },
  });
  const report = diagnostics.exportReport({ version: '0.1.0', apiKey: 'pk_private', state: key });
  for (const secret of [key, key.slice(0, 8), 'owner@example.test', 'PKT01_GREY_DEMO', '01:23:45:67:89:AB', 'unlisted-value', 'pk_private']) {
    assert.ok(!report.includes(secret));
  }
  assert.ok(report.includes('4000'));
  assert.deepEqual(Object.keys(diagnostics.getSnapshot()[0].details ?? {}), ['error', 'receivedBytes']);
});

test('generic redaction protects bearer tokens, API keys, UID, URLs and device UUIDs', () => {
  const diagnostics = createDiagnostics();
  const raw = 'Bearer unknown-token pk_somekey userId=short-id password=8letters ' +
    'uidABCDEFGHIJKLMNOPQRST https://example.test/callback?code=xyz&state=abc ' +
    '12345678-1234-1234-1234-123456789abc';
  const redacted = diagnostics.redact(raw);
  for (const secret of ['unknown-token', 'pk_somekey', 'short-id', '8letters', 'uidABCDEFGHIJKLMNOPQRST', 'code=xyz', 'state=abc', '12345678-1234-1234-1234-123456789abc']) {
    assert.ok(!redacted.includes(secret));
  }
  const json = diagnostics.redact('{"password":"short","uid":"other","client_secret":"secret"} APP&SK&punct!key?value#1');
  for (const secret of ['short', 'other', 'secret"}', 'punct!key?value#1']) assert.ok(!json.includes(secret));
});

test('snapshot is cached, notifications unsubscribe, logs bounded to 200 immutable entries', () => {
  const diagnostics = createDiagnostics();
  assert.equal(diagnostics.getSnapshot(), diagnostics.getSnapshot());
  let changes = 0;
  const unsubscribe = diagnostics.subscribe(() => changes++);
  diagnostics.log('test', 'one');
  const afterFirst = diagnostics.getSnapshot();
  assert.equal(afterFirst, diagnostics.getSnapshot());
  assert.equal(changes, 1);
  unsubscribe();
  for (let i = 0; i < 250; i++) diagnostics.log('test', `item ${i}`);
  assert.equal(changes, 1);
  assert.equal(diagnostics.getSnapshot().length, 200);
  assert.ok(Object.isFrozen(diagnostics.getSnapshot()));
  assert.ok(Object.isFrozen(diagnostics.getSnapshot()[0]));
});

test('secrets discovered later redact existing messages and short-lived registrations can be released', () => {
  const diagnostics = createDiagnostics();
  diagnostics.log('test', 'old short-secret');
  const release = diagnostics.registerSecret('short-secret');
  assert.ok(!diagnostics.exportReport().includes('short-secret'));
  assert.equal(diagnostics.redact('short-secret'), '[redacted]');
  release(); release();
  assert.equal(diagnostics.redact('short-secret'), 'short-secret');
  assert.ok(!diagnostics.exportReport().includes('short-secret'));
});

test('ChatGPT authorization hints and host identifiers are redacted even without registration', () => {
  const log = createDiagnostics();
  const text = log.redact('https://auth.openai.com/api/accounts/authorize?id_token_hint=short%2Esecret&login_hint=name%40example.com&ext_agent_host_id=urn%3Auuid%3Aprivate&nonce=short-nonce&code=one-use');
  for (const secret of ['short%2Esecret', 'name%40example.com', 'urn%3Auuid%3Aprivate', 'short-nonce', 'one-use']) assert.ok(!text.includes(secret));
});
