import assert from 'node:assert/strict';
import test from 'node:test';
import { bluetoothTransfer } from '../src/lib/pocket/bluetooth-transfer';
import type { PocketConnection } from '../src/lib/pocket/connection';
import { ResponseInbox } from '../src/lib/pocket/inbox';
import type { DownloadTarget, Recording } from '../src/lib/pocket/types';

const recording: Recording = { id: '2026-10-07/20261007112233', date: '2026-10-07', timestamp: '20261007112233', durationSeconds: 1 };
function fixture(send: (push: (bytes: Uint8Array) => void, inbox: ResponseInbox) => void, write?: (bytes: Uint8Array) => void) {
  const inbox = new ResponseInbox();
  let push!: (bytes: Uint8Array) => void;
  let stopped = false;
  const saved: number[] = [];
  const connection = {
    inbox,
    audio: async (callback: (bytes: Uint8Array) => void) => { push = callback; return () => { stopped = true; }; },
    request: async (command: string) => { assert.equal(command, 'U&2026-10-07&20261007112233'); send(push, inbox); return '5'; },
  } as unknown as PocketConnection;
  const target: DownloadTarget = { uri: 'test.part', write: bytes => { write?.(bytes); saved.push(...bytes); }, commit: async () => { throw new Error('commit belongs to the client'); }, abort: () => {} };
  return { connection, target, saved, stopped: () => stopped };
}

test('BLE transfer streams notification fragments and verifies an early OFF from history', async () => {
  const f = fixture((push, inbox) => { push(Uint8Array.of(1, 2)); push(Uint8Array.of(3)); push(Uint8Array.of(4, 5)); inbox.push({ name: 'OFF', value: '' }); });
  const bytes = await bluetoothTransfer(f.connection, recording, f.target, new AbortController().signal, () => {});
  assert.equal(bytes, 5);
  assert.deepEqual(f.saved, [1, 2, 3, 4, 5]);
  assert.equal(f.stopped(), true);
});

test('receiving all announced bytes still requires OFF and remains cancellable', async () => {
  const f = fixture(push => { push(Uint8Array.of(1, 2, 3, 4, 5)); });
  const controller = new AbortController();
  const transfer = bluetoothTransfer(f.connection, recording, f.target, controller.signal, () => {});
  const timer = setTimeout(() => controller.abort(), 10);
  await assert.rejects(transfer, { code: 'cancelled' });
  clearTimeout(timer);
  assert.equal(f.stopped(), true);
});

test('oversized notifications and failed file writes cannot return a verified download', async () => {
  const extra = fixture((push, inbox) => { push(Uint8Array.of(1, 2, 3, 4, 5, 6)); inbox.push({ name: 'OFF', value: '' }); });
  await assert.rejects(bluetoothTransfer(extra.connection, recording, extra.target, new AbortController().signal, () => {}), { code: 'transfer' });
  assert.equal(extra.stopped(), true);
  const full = fixture((push, inbox) => { push(Uint8Array.of(1, 2, 3, 4, 5)); inbox.push({ name: 'OFF', value: '' }); }, () => { throw new Error('disk full'); });
  await assert.rejects(bluetoothTransfer(full.connection, recording, full.target, new AbortController().signal, () => {}), { code: 'storage' });
  assert.equal(full.stopped(), true);
});
