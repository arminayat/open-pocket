import assert from 'node:assert/strict';
import test from 'node:test';
import { openAIRequest, tokenRequest } from '../src/lib/chatgpt/http';
import { ChatGPTError, ChatGPTHttpError, RESOURCE } from '../src/lib/chatgpt/types';

const url = 'https://auth.openai.com/synthetic';
const fetcher = (body: string, status = 200): typeof fetch => async () => new Response(body, { status });

test('HTTP errors preserve safe OAuth codes in string and nested formats without exposing body contents', async () => {
  for (const body of [
    { error: 'invalid_grant', error_description: 'private-token' },
    { error: { code: 'invalid_grant', message: 'private-token' } },
  ]) {
    await assert.rejects(openAIRequest(url, {}, fetcher(JSON.stringify(body), 400)), error =>
      error instanceof ChatGPTHttpError && error.code === 'invalid_grant' && error.status === 400 && !error.message.includes('private-token'));
  }
  for (const body of [
    '{"detail":"private-token"}', '{"error":{"code":"private-token"}}', '{"error":42}', 'private-token',
    JSON.stringify({ error: { code: 'a'.repeat(81) } }),
  ]) {
    await assert.rejects(openAIRequest(url, {}, fetcher(body, 503)), error =>
      error instanceof ChatGPTHttpError && error.code === null && error.status === 503 && !error.message.includes('private-token'));
  }
});

test('network failures and oversized responses do not expose credentials', async () => {
  const failed: typeof fetch = async () => { throw new Error('https://example.test/?token=private-token'); };
  await assert.rejects(openAIRequest(url, {}, failed), error => error instanceof ChatGPTError && !error.message.includes('private-token'));
  await assert.rejects(openAIRequest(url, {}, fetcher(`private-token${'a'.repeat(256_000)}`)), error =>
    error instanceof ChatGPTError && !error.message.includes('private-token'));
});

test('token exchange form encodes credentials, pins resource and forbids credential-bearing redirects', async () => {
  const mock: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init?.body))), {
      grant_type: 'authorization_code', client_id: 'oaiapp_synthetic', code: 'synthetic+code&value', resource: RESOURCE,
    });
    return new Response('{"id_token":"synthetic-id"}');
  };
  assert.deepEqual(await tokenRequest({
    grant_type: 'authorization_code', client_id: 'oaiapp_synthetic', code: 'synthetic+code&value', resource: 'https://attacker.test',
  }, mock), { id_token: 'synthetic-id' });
});

test('empty successful revocation body is accepted without requiring JSON', async () => {
  assert.equal(await openAIRequest(url, {}, fetcher('')), null);
});
