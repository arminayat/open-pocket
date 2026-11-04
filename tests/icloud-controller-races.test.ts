import assert from 'node:assert/strict';
import test from 'node:test';
import { createICloudController, ICLOUD_OFF, type ICloudPreference } from '../src/lib/icloud/controller';

const account = 'a'.repeat(64);
const enabled = { enabled: true, accountId: account };
const result = { pending: 0, errors: 0, conflicts: 0, published: 0, imported: 0, uploaded: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(overrides: Partial<Parameters<typeof createICloudController>[0]> = {}) {
  let saved: ICloudPreference = { ...ICLOUD_OFF };
  let reconciles = 0;
  const controller = createICloudController({
    loadPreference: async () => saved,
    savePreference: async value => { saved = value; },
    status: async () => ({ available: true, accountId: account, reason: '' }),
    open: async () => 'session', close: () => {},
    reconcile: async (_session, checkActive) => { checkActive(); reconciles += 1; return result; },
    ...overrides,
  });
  return { controller, saved: () => saved, reconciles: () => reconciles };
}

test('an Off choice while preference loading is suspended cannot be undone by the older On snapshot', async () => {
  const load = deferred<ICloudPreference>();
  const f = fixture({ loadPreference: () => load.promise });
  const loading = f.controller.load();
  await f.controller.setEnabled(false);
  assert.deepEqual(f.saved(), ICLOUD_OFF);
  load.resolve(enabled); await loading; await f.controller.sync();
  assert.equal(f.controller.snapshot().enabled, false);
  assert.equal(f.reconciles(), 0);
});

test('loading starts after an Off intent without reviving a stale saved On preference', async () => {
  const write = deferred<void>();
  const f = fixture({ loadPreference: async () => enabled, savePreference: () => write.promise });
  const disabling = f.controller.setEnabled(false);
  await f.controller.load(); write.resolve(); await disabling;
  await f.controller.sync();
  assert.equal(f.controller.snapshot().enabled, false); assert.equal(f.reconciles(), 0);
});

test('backgrounding during opt-in persistence keeps memory consistent with durable consent and defers all cloud work', async () => {
  const entered = deferred<void>(); const finish = deferred<void>();
  let saved: ICloudPreference = { ...ICLOUD_OFF };
  const f = fixture({ savePreference: async value => { saved = value; entered.resolve(); await finish.promise; } });
  await f.controller.load();
  const enabling = f.controller.setEnabled(true); await entered.promise;
  f.controller.setForeground(false); finish.resolve(); await enabling;
  assert.deepEqual(saved, enabled); assert.equal(f.controller.snapshot().enabled, true);
  await f.controller.sync(); assert.equal(f.reconciles(), 0);
  f.controller.setForeground(true); await f.controller.sync(); assert.equal(f.reconciles(), 1);
});

test('a changed account requires new consent even when that account cannot currently access the container', async () => {
  const f = fixture({
    loadPreference: async () => enabled,
    status: async () => ({ available: false, accountId: 'b'.repeat(64), reason: 'Container unavailable' }),
  });
  await f.controller.load(); await f.controller.sync();
  assert.equal(f.controller.snapshot().needsConfirmation, true);
  assert.equal(f.controller.snapshot().enabled, false);
  assert.equal(f.reconciles(), 0);
});
