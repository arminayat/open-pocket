import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDuration, latestCopy, mergeRecordings, recordingTime } from '../src/lib/pocket/recording-list';
import type { LocalRecording, Recording } from '../src/lib/pocket/types';

const recording = (id: string, date = '2026-10-29', timestamp = `20261029${id}`): Recording =>
  ({ id, date, timestamp, durationSeconds: 68 });
const saved = (id: string, downloadedAt: string, transport: LocalRecording['transport'] = 'bluetooth', date?: string): LocalRecording =>
  ({ ...recording(id, date), uri: `file:///${id}-${transport}.mp3`, bytes: 1000, transport, downloadedAt });

test('merged list keeps the device listing, adds saved-only recordings, and sorts newest first', () => {
  const listing = [recording('090000'), recording('130000')];
  const library = [saved('130000', '2026-10-29T13:10:00Z'), saved('080000', '2026-10-28T08:10:00Z', 'bluetooth', '2026-10-28')];
  assert.deepEqual(mergeRecordings(listing, library).map(item => item.id), ['130000', '090000', '080000']);
});

test('the most recently downloaded copy represents a recording', () => {
  const library = [saved('a', '2026-10-29T10:00:00Z', 'wifi'), saved('a', '2026-10-29T11:00:00Z', 'bluetooth'), saved('b', '2026-10-29T12:00:00Z')];
  assert.equal(latestCopy(library, 'a')?.transport, 'bluetooth');
  assert.equal(latestCopy(library, 'missing'), undefined);
});

test('times and durations are formatted for display', () => {
  assert.equal(recordingTime(recording('134902')), '13:49');
  assert.equal(recordingTime({ ...recording('x'), timestamp: 'icloud' }), 'icloud');
  assert.equal(formatDuration(68), '1m 8s');
});
