import assert from 'node:assert/strict';
import test from 'node:test';
import { abortable, delay, ResponseInbox } from '../src/lib/pocket/inbox';
import { disconnectedError } from '../src/lib/pocket/protocol';

test('a reply arriving before wait registration is retained, and stale replies are excluded', async () => {
  const inbox = new ResponseInbox();
  inbox.push({ name: 'U', value: 'old' });
  const mark = inbox.mark();
  inbox.push({ name: 'U', value: 'WIFI' });
  inbox.push({ name: 'U', value: '1234' });
  assert.equal((await inbox.wait('U', mark, 100, undefined, value => /^\d+$/.test(value))).value, '1234');
  assert.equal(inbox.after(mark).length, 2);
});

test('cancellation rejects and removes a pending waiter', async () => {
  const inbox = new ResponseInbox();
  const controller = new AbortController();
  const waiting = inbox.wait('OFF', inbox.mark(), 10000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { code: 'cancelled' });
  inbox.push({ name: 'OFF', value: '' });
  assert.equal((await inbox.wait('OFF', 0, 10)).name, 'OFF');
});

test('disconnect wakes all waiters and later requests fail immediately', async () => {
  const inbox = new ResponseInbox();
  const waiting = inbox.wait('OFF', 0, 10000);
  inbox.fail(disconnectedError());
  await assert.rejects(waiting, { code: 'disconnected' });
  await assert.rejects(inbox.wait('BAT', 0), { code: 'disconnected' });
});

test('timeout does not satisfy a subsequent request with another command', async () => {
  const inbox = new ResponseInbox();
  await assert.rejects(inbox.wait('LIST', 0, 5), { code: 'timeout' });
  const mark = inbox.mark();
  const waiting = inbox.wait('FW', mark, 100);
  inbox.push({ name: 'LIST', value: '0' });
  inbox.push({ name: 'FW', value: '1.8' });
  assert.equal((await waiting).value, '1.8');
});

test('native promises and timing delays become cancellable without unhandled rejections', async () => {
  const controller = new AbortController();
  let rejectNative!: (error: Error) => void;
  const native = new Promise<void>((_, reject) => { rejectNative = reject; });
  const waiting = abortable(native, controller.signal);
  const sleeping = delay(10000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { code: 'cancelled' });
  await assert.rejects(sleeping, { code: 'cancelled' });
  rejectNative(new Error('late native failure'));
  await Promise.resolve();
});
