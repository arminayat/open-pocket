import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatGPTAccounts } from '../src/lib/chatgpt/accounts';
import { ChatGPTCancelled, ChatGPTError, ChatGPTHttpError, DIRECT_SCOPE, type ChatGPTProfile, type ChatGPTStore, type ChatGPTTokens } from '../src/lib/chatgpt/types';

const hostId = 'urn:uuid:12345678-1234-4234-8234-123456789abc';
const now = 1_000_000;
const tokens = (suffix = 'original', expiresAt = now + 3_600_000): ChatGPTTokens => ({
  accessToken: `synthetic-access-${suffix}`, refreshToken: `synthetic-refresh-${suffix}`,
  idToken: 'synthetic-id', scopes: ['openid', 'resource.invoke', DIRECT_SCOPE], expiresAt,
});
const profile = (clientId = 'oaiapp_first', expiresAt?: number): ChatGPTProfile => ({
  clientId, subject: `subject-${clientId}`, email: 'same@example.test', tokens: tokens(clientId, expiresAt),
});
const existingStore = (...profiles: ChatGPTProfile[]): ChatGPTStore => ({ hostId, profiles, activeClientId: profiles[0]?.clientId ?? null });
type Dependencies = Parameters<typeof createChatGPTAccounts>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(initial: ChatGPTStore | null = null, overrides: Partial<Dependencies> = {}) {
  let persisted = initial ? structuredClone(initial) : null;
  const saved: ChatGPTStore[] = [];
  const deps: Dependencies = {
    load: async () => persisted ? structuredClone(persisted) : null,
    save: async next => { persisted = structuredClone(next); saved.push(structuredClone(next)); },
    newHostId: () => hostId, now: () => now,
    authorize: async () => { throw new Error('Unexpected authorization'); },
    refresh: async () => { throw new Error('Unexpected refresh'); },
    revoke: async () => {}, ...overrides,
  };
  return { deps, accounts: createChatGPTAccounts(deps), saved, persisted: () => persisted };
}

test('concurrent initialization creates and persists only one host identity', async () => {
  const read = deferred<ChatGPTStore | null>();
  let loads = 0;
  let hosts = 0;
  const f = fixture(null, { load: () => { loads++; return read.promise; }, newHostId: () => { hosts++; return hostId; } });
  const first = f.accounts.load();
  const second = f.accounts.load();
  read.resolve(null);
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(hosts, 1);
  assert.equal(f.saved.length, 1);
  assert.equal(f.persisted()?.hostId, hostId);
  assert.equal(f.accounts.snapshot().loading, false);
});

test('issued registration survives failed exchange so reconnect reuses it without replacing active account', async () => {
  const active = profile();
  const f = fixture(existingStore(active));
  let attempts = 0;
  f.deps.authorize = async (host, selected, registered) => {
    assert.equal(host, hostId);
    attempts++;
    if (attempts === 1) {
      assert.equal(selected, undefined);
      await registered('oaiapp_second');
      throw new ChatGPTHttpError(400, 'invalid_grant');
    }
    assert.equal(selected?.clientId, 'oaiapp_second');
    return { clientId: 'oaiapp_second', identity: { subject: 'second-subject', email: 'same@example.test' }, tokens: tokens('second') };
  };
  await f.accounts.load();
  await f.accounts.connect();
  assert.equal(f.accounts.snapshot().activeClientId, active.clientId);
  assert.equal(f.persisted()?.profiles[1].tokens, null);
  assert.ok(f.accounts.snapshot().error);
  await f.accounts.connect('oaiapp_second');
  assert.equal(f.accounts.snapshot().activeClientId, 'oaiapp_second');
  assert.equal(f.persisted()?.profiles.length, 2);
  assert.equal(f.persisted()?.profiles[0].tokens?.accessToken, active.tokens?.accessToken);
  assert.doesNotMatch(JSON.stringify(f.accounts.snapshot()), /synthetic-(access|refresh|id)/);
});

test('returning authorization cannot swap the saved client or verified subject', async () => {
  const active = profile();
  for (const mismatch of ['client', 'subject', 'registration'] as const) {
    const f = fixture(existingStore(active), {
      authorize: async (_host, _selected, registered) => {
        if (mismatch === 'registration') await registered('oaiapp_other');
        return {
          clientId: mismatch === 'client' ? 'oaiapp_other' : active.clientId,
          identity: { subject: mismatch === 'subject' ? 'different-subject' : active.subject!, email: active.email },
          tokens: tokens('must-not-save'),
        };
      },
    });
    await f.accounts.load();
    await f.accounts.connect(active.clientId);
    assert.deepEqual(f.persisted(), existingStore(active));
    assert.equal(f.accounts.snapshot().activeClientId, active.clientId);
    assert.match(f.accounts.snapshot().error!, /different account/);
  }
});

test('cancelled authorization preserves the active credentials and produces no failure', async () => {
  const active = profile();
  const f = fixture(existingStore(active), { authorize: async () => { throw new ChatGPTCancelled('Cancelled'); } });
  await f.accounts.load();
  await f.accounts.connect();
  assert.deepEqual(f.persisted(), existingStore(active));
  assert.equal(f.accounts.snapshot().error, null);
  assert.equal(f.accounts.snapshot().busy, false);
});

test('same-email accounts keep distinct stable labels after reauthorization and sign-out', async () => {
  const first = profile();
  const second = profile('oaiapp_second');
  const f = fixture(existingStore(first, second), {
    authorize: async (_host, selected) => ({ clientId: selected!.clientId, identity: { subject: selected!.subject!, email: selected!.email }, tokens: tokens('updated') }),
  });
  await f.accounts.load();
  const labels = f.accounts.snapshot().profiles.map(item => [item.clientId, item.label]);
  assert.notEqual(labels[0][1], labels[1][1]);
  await f.accounts.connect(first.clientId);
  assert.deepEqual(f.accounts.snapshot().profiles.map(item => [item.clientId, item.label]), labels);
  await f.accounts.signOut(first.clientId);
  assert.deepEqual(f.accounts.snapshot().profiles.map(item => [item.clientId, item.label]), labels);
  assert.equal(f.persisted()?.profiles.find(item => item.clientId === second.clientId)?.tokens?.accessToken, second.tokens?.accessToken);
});

test('identity-only connection is signed in but never enables the ChatGPT plan', async () => {
  const f = fixture(null, {
    authorize: async (_host, _selected, registered) => {
      await registered('oaiapp_identity');
      return { clientId: 'oaiapp_identity', identity: { subject: 'identity-subject', email: null }, tokens: { ...tokens(), accessToken: null, refreshToken: null, scopes: ['openid'], expiresAt: now } };
    },
  });
  await f.accounts.load();
  await f.accounts.connect();
  assert.equal(f.accounts.snapshot().profiles[0].signedIn, true);
  assert.equal(f.accounts.snapshot().profiles[0].planEnabled, false);
  assert.match(f.accounts.snapshot().notice!, /Plan access is not enabled/);
});

test('concurrent refreshes rotate credentials once and keep same-email account labels stable', async () => {
  const active = profile('oaiapp_first', now + 30_000);
  const refresh = deferred<ChatGPTTokens>();
  let calls = 0;
  const f = fixture(existingStore(active, profile('oaiapp_second')), {
    refresh: async (clientId, previous) => { calls++; assert.equal(clientId, active.clientId); assert.equal(previous.refreshToken, active.tokens?.refreshToken); return refresh.promise; },
  });
  await f.accounts.load();
  const labels = f.accounts.snapshot().profiles.map(item => [item.clientId, item.label]);
  const first = f.accounts.refreshActive();
  const second = f.accounts.refreshActive();
  assert.equal(calls, 1);
  refresh.resolve(tokens('rotated'));
  await Promise.all([first, second]);
  await f.accounts.refreshActive();
  assert.equal(calls, 1);
  assert.equal(f.persisted()?.profiles[0].tokens?.refreshToken, 'synthetic-refresh-rotated');
  assert.deepEqual(f.accounts.snapshot().profiles.map(item => [item.clientId, item.label]), labels);
});

test('temporary refresh failure keeps credentials; terminal rejection clears only that session', async () => {
  const active = profile('oaiapp_first', now - 1);
  const other = profile('oaiapp_second');
  for (const cause of [new ChatGPTError('Temporary connection failure'), new ChatGPTHttpError(503, 'subscription_sharing_usage_unavailable'), new ChatGPTHttpError(400, 'invalid_client')]) {
    const f = fixture(existingStore(active, other), { refresh: async () => { throw cause; } });
    await f.accounts.load();
    await f.accounts.refreshActive();
    assert.deepEqual(f.persisted(), existingStore(active, other));
    assert.equal(f.accounts.snapshot().activeClientId, active.clientId);
  }
  for (const code of ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']) {
    const f = fixture(existingStore(active, other), { refresh: async () => { throw new ChatGPTHttpError(400, code); } });
    await f.accounts.load();
    await f.accounts.refreshActive();
    assert.equal(f.persisted()?.profiles[0].tokens, null);
    assert.equal(f.persisted()?.profiles[0].subject, active.subject);
    assert.deepEqual(f.persisted()?.profiles[1], other);
    assert.equal(f.accounts.snapshot().activeClientId, null);
    assert.match(f.accounts.snapshot().error!, /session ended/);
  }
});

test('a rotated refresh token is never replayed after secure-storage persistence fails', async () => {
  const active = profile('oaiapp_first', now - 1);
  let clock = now;
  const seen: (string | null)[] = [];
  const f = fixture(existingStore(active), {
    now: () => clock,
    refresh: async (_client, previous) => { seen.push(previous.refreshToken); return tokens(`rotation-${seen.length}`, clock + 120_000); },
    save: async () => { throw new Error('synthetic Keychain failure'); },
  });
  await f.accounts.load();
  await f.accounts.refreshActive();
  assert.match(f.accounts.snapshot().error!, /saved securely/);
  assert.equal(f.accounts.snapshot().profiles[0].planEnabled, true);
  clock += 120_000;
  await f.accounts.refreshActive();
  assert.deepEqual(seen, [active.tokens!.refreshToken]);
  let recovered: ChatGPTStore | undefined;
  f.deps.save = async next => { recovered = structuredClone(next); };
  await f.accounts.refreshActive();
  assert.deepEqual(seen, [active.tokens!.refreshToken, 'synthetic-refresh-rotation-1']);
  assert.equal(recovered?.profiles[0].tokens?.refreshToken, 'synthetic-refresh-rotation-2');
  assert.equal(f.accounts.snapshot().error, null);
});

test('failed remote sign-out clears local tokens, retains registration and warns about remote access', async () => {
  const active = profile();
  const other = profile('oaiapp_second');
  let revoked = false;
  const f = fixture(existingStore(active, other), {
    revoke: async (client, refresh) => { assert.equal(client, active.clientId); assert.equal(refresh, active.tokens?.refreshToken); revoked = true; throw new Error('offline'); },
  });
  await f.accounts.load();
  await f.accounts.signOut(active.clientId);
  assert.equal(revoked, true);
  assert.equal(f.persisted()?.hostId, hostId);
  assert.deepEqual(f.persisted()?.profiles[0], { ...active, tokens: null });
  assert.deepEqual(f.persisted()?.profiles[1], other);
  assert.equal(f.accounts.snapshot().activeClientId, null);
  assert.match(f.accounts.snapshot().notice!, /Remote sign-out could not be confirmed/);
  assert.equal(f.accounts.snapshot().profiles[0].signedIn, false);
});

test('failed local sign-out stops renewal and keeps sign-out retryable until credentials are removed', async () => {
  const active = profile('oaiapp_first', now - 1);
  const f = fixture(existingStore(active), { revoke: async () => { throw new Error('offline'); } });
  const persist = f.deps.save;
  f.deps.save = async () => { throw new Error('Keychain unavailable'); };
  await f.accounts.load();
  await f.accounts.signOut(active.clientId);
  assert.equal(f.accounts.snapshot().activeClientId, null);
  assert.equal(f.accounts.snapshot().profiles[0].signedIn, true); // Retry sign-out remains available.
  assert.equal(f.accounts.snapshot().profiles[0].planEnabled, false);
  assert.equal(f.accounts.snapshot().profiles[0].active, false);
  await f.accounts.refreshActive(); // An unexpected refresh would overwrite the storage error.
  assert.match(f.accounts.snapshot().error!, /saved securely/);
  f.deps.save = persist;
  await f.accounts.signOut(active.clientId);
  assert.equal(f.persisted()?.profiles[0].tokens, null);
  assert.equal(f.accounts.snapshot().profiles[0].signedIn, false);
  assert.match(f.accounts.snapshot().notice!, /Remote sign-out could not be confirmed/);
});

test('terminal credentials are removed from storage after a failed Keychain write without refreshing again', async () => {
  const active = profile('oaiapp_first', now - 1);
  let calls = 0;
  const f = fixture(existingStore(active), { refresh: async () => { calls++; throw new ChatGPTHttpError(400, 'invalid_grant'); } });
  const persist = f.deps.save;
  f.deps.save = async () => { throw new Error('Keychain unavailable'); };
  await f.accounts.load();
  await f.accounts.refreshActive();
  assert.equal(f.accounts.snapshot().profiles[0].signedIn, false);
  assert.ok(f.persisted()?.profiles[0].tokens);
  f.deps.save = persist;
  await f.accounts.refreshActive();
  assert.equal(f.persisted()?.profiles[0].tokens, null);
  assert.equal(calls, 1);
});
