import assert from 'node:assert/strict';
import test from 'node:test';
import { readPocketAccount, type AccountFetcher } from '../src/lib/account/http';

const ownerId = 'demoUserABC12345abcdefghijkl';
const accountResult = { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { userId: ownerId } }) }] };

test('MCP performs initialization and only the account-info tool with negotiated session headers', async () => {
  const methods: string[] = [];
  const fetcher: AccountFetcher = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    methods.push(request.method);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-credential');
    assert.equal(headers.get('Accept'), 'application/json, text/event-stream');
    if (request.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18' } }),
        { headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'synthetic-session' } });
    }
    assert.equal(headers.get('Mcp-Session-Id'), 'synthetic-session');
    assert.equal(headers.get('MCP-Protocol-Version'), '2025-06-18');
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.deepEqual(request.params, { name: 'get_account_info', arguments: {} });
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: accountResult })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } });
  };
  assert.deepEqual(await readPocketAccount('synthetic-credential', fetcher), { userId: ownerId, accountLabel: 'Pocket account' });
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/call']);
});

test('401 terminates immediately without refreshing or replaying rejected credentials', async () => {
  let calls = 0;
  const fetcher: AccountFetcher = async () => {
    calls++; return new Response('private credential text', { status: 401 });
  };
  await assert.rejects(readPocketAccount('synthetic-credential', fetcher), /authorization was rejected or expired/);
  assert.equal(calls, 1);
});

test('expired MCP session is reinitialized only once', async () => {
  let initializations = 0;
  let toolCalls = 0;
  const fetcher: AccountFetcher = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.method === 'initialize') {
      initializations++;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-03-26' } }),
        { headers: { 'Mcp-Session-Id': `session-${initializations}` } });
    }
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    toolCalls++;
    if (toolCalls === 1) return new Response('', { status: 404 });
    assert.equal(new Headers(init?.headers).get('Mcp-Session-Id'), 'session-2');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: accountResult }));
  };
  assert.equal((await readPocketAccount('synthetic-credential', fetcher)).userId, ownerId);
  assert.equal(initializations, 2);
  assert.equal(toolCalls, 2);
});

test('malformed responses and fetch failures never expose response body or URL credentials', async () => {
  const fetcher: AccountFetcher = async () => { throw new Error('URL?token=private-token'); };
  await assert.rejects(readPocketAccount('synthetic-credential', fetcher), (error: unknown) =>
    error instanceof Error && !error.message.includes('private-token'));
  const malformed: AccountFetcher = async () => new Response('private account contents');
  await assert.rejects(readPocketAccount('synthetic-credential', malformed), (error: unknown) =>
    error instanceof Error && !error.message.includes('private account'));
});
