import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_RECONNECT_RETRY_MS, autoReconnectDue, nextAutoDownload } from '../src/lib/pocket/auto-download';
import type { LocalRecording, Recording } from '../src/lib/pocket/types';

const recording = (id: string): Recording => ({ id, date: '2026-10-22', timestamp: id, durationSeconds: 60 });
const saved = (id: string, transport: LocalRecording['transport']): LocalRecording =>
  ({ ...recording(id), uri: `file:///${id}.mp3`, bytes: 1000, transport, downloadedAt: '2026-10-22T00:00:00Z' });

test('automatic download picks the newest recording without any local copy', () => {
  const listing = [recording('c'), recording('b'), recording('a')];
  assert.equal(nextAutoDownload(listing, [], new Set())?.id, 'c');
  // A copy from either transport counts as downloaded.
  assert.equal(nextAutoDownload(listing, [saved('c', 'wifi'), saved('b', 'bluetooth')], new Set())?.id, 'a');
  assert.equal(nextAutoDownload(listing, [saved('c', 'wifi'), saved('b', 'bluetooth'), saved('a', 'bluetooth')], new Set()), null);
});

test('recordings that failed or were cancelled this connection are not retried in a loop', () => {
  const listing = [recording('c'), recording('b')];
  assert.equal(nextAutoDownload(listing, [], new Set(['c']))?.id, 'b');
  assert.equal(nextAutoDownload(listing, [], new Set(['c', 'b'])), null);
});

test('automatic reconnect starts at once, then waits between attempts', () => {
  assert.equal(autoReconnectDue(null, 0), true);
  assert.equal(autoReconnectDue(1_000, 1_000 + AUTO_RECONNECT_RETRY_MS - 1), false);
  assert.equal(autoReconnectDue(1_000, 1_000 + AUTO_RECONNECT_RETRY_MS), true);
});
