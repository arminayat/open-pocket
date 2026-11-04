import assert from 'node:assert/strict';
import test from 'node:test';
import { createICloudController, ICLOUD_OFF, parseICloudPreference, type ICloudAvailability, type ICloudPreference } from '../src/lib/icloud/controller';
import type { ICloudSyncResult } from '../src/lib/icloud/types';

const account = 'a'.repeat(64);
const emptyResult: ICloudSyncResult = { pending: 0, errors: 0, conflicts: 0, published: 0, imported: 0, uploaded: 0 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(initial: ICloudPreference = ICLOUD_OFF) {
  let saved = { ...initial };
  let status: ICloudAvailability = { available: true, accountId: account, reason: '' };
  let failSave = false;
  let failLoad = false;
  let closes = 0;
  let opens = 0;
  let reconciles = 0;
  let reconcile = async (_session: string, check: () => void) => { check(); return emptyResult; };
  let save = async (next: ICloudPreference) => { saved = { ...next }; };
  let open = async (_account: string) => `session-${++opens}`;
  const client = createICloudController({
    loadPreference: async () => { if (failLoad) throw new Error('read'); return saved; },
    savePreference: async next => { if (failSave) throw new Error('write'); await save(next); },
    status: async () => status,
    open: value => open(value), close: () => { closes += 1; },
    reconcile: async (session, check) => { reconciles += 1; return reconcile(session, check); },
  });
  return { client, saved: () => saved, closes: () => closes, opens: () => opens, reconciles: () => reconciles,
    setStatus: (next: ICloudAvailability) => { status = next; },
    setFailSave: (value: boolean) => { failSave = value; }, setFailLoad: () => { failLoad = true; },
    setReconcile: (next: typeof reconcile) => { reconcile = next; },
    setSave: (next: typeof save) => { save = next; }, setOpen: (next: typeof open) => { open = next; } };
}

test('iCloud is off by default and never opens or reconciles before opt-in', async () => {
  const f = fixture(); await f.client.load(); await f.client.sync();
  assert.equal(f.client.snapshot().enabled, false); assert.equal(f.opens(), 0); assert.equal(f.reconciles(), 0);
});

test('preferences fail closed and cannot opt into an unidentified account', async () => {
  for (const value of [null, {}, { enabled: true }, { enabled: true, accountId: 'raw-account' }, { enabled: false, accountId: account }]) {
    assert.throws(() => parseICloudPreference(value));
  }
  const f = fixture(); f.setFailLoad(); await f.client.load(); await f.client.sync();
  assert.equal(f.reconciles(), 0); assert.equal(f.client.snapshot().enabled, false);
});

test('explicit opt-in persists the current account before opening a session', async () => {
  const f = fixture(); await f.client.load();
  f.setOpen(async value => { assert.equal(value, account); assert.deepEqual(f.saved(), { enabled: true, accountId: account }); return 'permitted'; });
  await f.client.setEnabled(true); await f.client.sync();
  assert.equal(f.reconciles(), 1); assert.equal(f.client.snapshot().error, null);
  assert.ok(f.client.snapshot().lastCheckedAt);
});

test('account changes pause reconciliation until a new explicit opt-in', async () => {
  const f = fixture({ enabled: true, accountId: account }); await f.client.load(); await f.client.sync();
  f.setStatus({ available: true, accountId: 'b'.repeat(64), reason: '' }); await f.client.sync();
  assert.equal(f.reconciles(), 1); assert.equal(f.client.snapshot().enabled, false);
  assert.equal(f.client.snapshot().needsConfirmation, true); assert.equal(f.client.snapshot().result, null);
  await f.client.sync(); assert.equal(f.reconciles(), 1);
  await f.client.setEnabled(true); await f.client.sync();
  assert.equal(f.reconciles(), 2); assert.equal(f.saved().accountId, 'b'.repeat(64));
});

test('unavailable iCloud performs no writes and can retry later', async () => {
  const f = fixture({ enabled: true, accountId: account }); await f.client.load();
  f.setStatus({ available: false, accountId: null, reason: 'Enable iCloud Drive.' }); await f.client.sync();
  assert.equal(f.reconciles(), 0); assert.equal(f.client.snapshot().error, 'Enable iCloud Drive.');
  f.setStatus({ available: true, accountId: account, reason: '' }); await f.client.sync(); assert.equal(f.reconciles(), 1);
});

test('opt-out immediately revokes work before preference persistence finishes', async () => {
  const f = fixture({ enabled: true, accountId: account }); await f.client.load();
  const entered = deferred<void>(); const resume = deferred<void>();
  f.setReconcile(async (_session, check) => { entered.resolve(); await resume.promise; check(); return emptyResult; });
  const running = f.client.sync(); await entered.promise;
  const before = f.closes(); const disabling = f.client.setEnabled(false);
  assert.equal(f.client.snapshot().enabled, false); assert.equal(f.closes(), before + 1);
  resume.resolve(); await Promise.all([running, disabling]);
  assert.equal(f.client.snapshot().lastCheckedAt, null); assert.deepEqual(f.saved(), ICLOUD_OFF);
});

test('failed opt-out storage remains off in memory and offers a save-only retry', async () => {
  const f = fixture({ enabled: true, accountId: account }); await f.client.load(); f.setFailSave(true);
  await f.client.setEnabled(false); await f.client.sync();
  assert.equal(f.reconciles(), 0); assert.equal(f.client.snapshot().unsavedOptOut, true);
  f.setFailSave(false); await f.client.setEnabled(false);
  assert.equal(f.client.snapshot().unsavedOptOut, false); assert.deepEqual(f.saved(), ICLOUD_OFF);
});

test('failed opt-in storage cannot start cloud work', async () => {
  const f = fixture(); await f.client.load(); f.setFailSave(true);
  await f.client.setEnabled(true); await f.client.sync();
  assert.equal(f.client.snapshot().enabled, false); assert.equal(f.reconciles(), 0);
});

test('reconciliation is serialized and backgrounding revokes the active generation', async () => {
  const f = fixture({ enabled: true, accountId: account }); await f.client.load();
  const entered = deferred<void>(); const resume = deferred<void>();
  f.setReconcile(async (_session, check) => { entered.resolve(); await resume.promise; check(); return emptyResult; });
  const running = f.client.sync(); await entered.promise; await f.client.sync();
  assert.equal(f.reconciles(), 1); f.client.setForeground(false); resume.resolve(); await running;
  assert.equal(f.client.snapshot().lastCheckedAt, null); await f.client.sync(); assert.equal(f.reconciles(), 1);
  f.client.setForeground(true); await f.client.sync(); assert.equal(f.reconciles(), 2);
});

test('a queued opt-out wins over an opt-in whose storage write is already running', async () => {
  const f = fixture(); await f.client.load(); const entered = deferred<void>(); const resume = deferred<void>();
  const writes: ICloudPreference[] = [];
  f.setSave(async next => { writes.push(next); if (next.enabled) { entered.resolve(); await resume.promise; } });
  const enabling = f.client.setEnabled(true); await entered.promise;
  const disabling = f.client.setEnabled(false); resume.resolve(); await Promise.all([enabling, disabling]);
  assert.deepEqual(writes, [{ enabled: true, accountId: account }, ICLOUD_OFF]);
  assert.equal(f.client.snapshot().enabled, false); await f.client.sync(); assert.equal(f.reconciles(), 0);
});

test('a delayed open cannot restore a session after opt-out', async () => {
  const f = fixture({ enabled: true, accountId: account }); await f.client.load();
  const entered = deferred<void>(); const resume = deferred<string>();
  f.setOpen(async () => { entered.resolve(); return resume.promise; });
  const running = f.client.sync(); await entered.promise; await f.client.setEnabled(false);
  resume.resolve('revoked-session'); await running;
  assert.equal(f.reconciles(), 0); assert.equal(f.client.snapshot().result, null);
});
