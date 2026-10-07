import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRecording, parseLibraryIndex } from '../src/storage/library-index';
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
