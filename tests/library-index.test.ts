import assert from 'node:assert/strict';
import test from 'node:test';
import { createIndexPublicationQueue, indexRecording, parseLibraryIndex } from '../src/storage/library-index';
import type { LocalRecording } from '../src/lib/pocket/types';

const file: LocalRecording = {
  id: '2026-10-07/20261007120000', date: '2026-10-07', timestamp: '20261007120000',
  durationSeconds: 25, uri: 'file:///old-app-container/Documents/recordings/example.mp3',
  bytes: 100_000, transport: 'wifi', downloadedAt: '2026-10-07T12:00:00Z',
};

test('library index keeps relative file names so app-container changes preserve recordings', () => {
  const stored = indexRecording(file, '2026-10-07_20261007120000_wifi_1.mp3');
  assert.equal('uri' in stored, false);
  assert.deepEqual(parseLibraryIndex(JSON.parse(JSON.stringify([stored]))), [stored]);
});

test('invalid index entries cannot escape the recording directory or advertise incomplete files', () => {
  const valid = indexRecording(file, 'valid.mp3');
  assert.deepEqual(parseLibraryIndex([null, { ...valid, filename: '../outside.mp3' },
    { ...valid, filename: '/outside.mp3' }, { ...valid, filename: 'partial.part' },
    { ...valid, bytes: 0 }, { ...valid, transport: 'unknown' }, valid]), [valid]);
});

test('iCloud files keep the same portable library schema without adding a recorder transport', () => {
  const cloud = indexRecording({ ...file, transport: 'icloud' }, `icloud_${'a'.repeat(64)}.mp3`);
  assert.deepEqual(parseLibraryIndex([cloud]), [cloud]);
});

test('shared publication queue prevents concurrent cloud imports and recorder commits losing entries', async () => {
  const queue = createIndexPublicationQueue();
  let stored = ['older'];
  let release!: () => void;
  const started: string[] = [];
  const first = queue(async () => {
    started.push('recorder');
    const previous = [...stored];
    await new Promise<void>(resolve => { release = resolve; });
    stored = [...previous, 'recorder'];
  });
  const second = queue(async () => { started.push('cloud'); stored = [...stored, 'cloud']; });
  await Promise.resolve();
  assert.deepEqual(started, ['recorder']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(stored, ['older', 'recorder', 'cloud']);
});

test('failed index publication does not block a later import', async () => {
  const queue = createIndexPublicationQueue();
  const failed = queue(async () => { throw new Error('disk full'); });
  const imported = queue(async () => 'adopted');
  await assert.rejects(failed, /disk full/);
  assert.equal(await imported, 'adopted');
});
