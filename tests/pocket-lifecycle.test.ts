import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionGeneration } from '../src/lib/pocket/lifecycle';
import { deadline } from '../src/lib/pocket/inbox';
import { PocketError } from '../src/lib/pocket/protocol';

type FakeDevice = { id: string; cancelConnection(): Promise<void> };
function pendingConnection() {
  let resolve!: (device: FakeDevice) => void;
  const promise = new Promise<FakeDevice>(done => { resolve = done; });
  let cancelled = false;
  const device: FakeDevice = { id: 'fake-recorder', cancelConnection: async () => { cancelled = true; } };
  return { promise, resolve: () => resolve(device), device, cancelled: () => cancelled };
}

test('disconnect while a native connection is pending releases the late device before assignment', async () => {
  const lifecycle = new ConnectionGeneration();
  const generation = lifecycle.invalidate();
  const manager = pendingConnection();
  let assigned: FakeDevice | null = null;
  const connecting = lifecycle.adopt(generation, manager.promise, device => device.cancelConnection()).then(device => { assigned = device; });
  lifecycle.invalidate(); // provider unmount calls disconnect
  manager.resolve();
  await assert.rejects(connecting, { code: 'disconnected' });
  assert.equal(manager.cancelled(), true);
  assert.equal(assigned, null);
});

test('a stale connection failure cannot release a newer session', async () => {
  const lifecycle = new ConnectionGeneration();
  const oldGeneration = lifecycle.invalidate();
  const oldManager = pendingConnection();
  const oldConnecting = lifecycle.adopt(oldGeneration, oldManager.promise, device => device.cancelConnection());
  const newGeneration = lifecycle.invalidate();
  const newManager = pendingConnection();
  const newConnecting = lifecycle.adopt(newGeneration, newManager.promise, device => device.cancelConnection());
  newManager.resolve();
  assert.equal(await newConnecting, newManager.device);
  oldManager.resolve();
  await assert.rejects(oldConnecting, { code: 'disconnected' });
  assert.equal(oldManager.cancelled(), true);
  assert.equal(newManager.cancelled(), false);
  assert.equal(lifecycle.current(newGeneration), true);
  assert.equal(lifecycle.current(oldGeneration), false);
});

test('discovery and queued work reject after their session is invalidated', () => {
  const lifecycle = new ConnectionGeneration();
  const discovery = lifecycle.invalidate();
  lifecycle.assertCurrent(discovery);
  lifecycle.invalidate();
  assert.throws(() => lifecycle.assertCurrent(discovery), { code: 'disconnected' });
});

test('deadline rejects a native call that never settles and passes through settled results', async () => {
  const stalled = deadline(new Promise<never>(() => {}), 10, () => new PocketError('stalled', 'stalled'));
  await assert.rejects(stalled, (error: unknown) => error instanceof PocketError && error.code === 'stalled');
  assert.equal(await deadline(Promise.resolve('ok'), 10, () => new Error('late')), 'ok');
  await assert.rejects(deadline(Promise.reject(new Error('native')), 10, () => new Error('late')), /native/);
});
