import assert from 'node:assert/strict';
import test from 'node:test';
import { publishIndexSnapshot, readIndexSnapshot, type IndexStorage } from '../src/storage/index-snapshots';
import type { StoredRecording } from '../src/storage/library-index';

const old: StoredRecording = {
  id: '2026-10-07/20261007120000', date: '2026-10-07', timestamp: '20261007120000',
  durationSeconds: 25, bytes: 100000, transport: 'wifi', downloadedAt: '2026-10-07T12:00:00Z', filename: 'old.mp3',
};
const next: StoredRecording = { ...old, filename: 'new.mp3', bytes: 100001 };
function fixture(failure?: 'write' | 'move' | 'prune') {
  const previous = JSON.stringify([old]);
  const files = new Map([['index.json', previous]]);
  const storage: IndexStorage = {
    list: () => [...files.keys()],
    read: async name => { if (!files.has(name)) throw new Error('missing'); return files.get(name)!; },
    write: (name, content) => { files.set(name, failure === 'write' ? '[' : content); if (failure === 'write') throw new Error('disk full'); },
    move: (from, to) => {
      if (failure === 'move') throw new Error('rename failed');
      if (files.has(to) || !files.has(from)) throw new Error('invalid rename');
      files.set(to, files.get(from)!); files.delete(from);
    },
    remove: name => { if (failure === 'prune' && name === 'index.json') throw new Error('delete denied'); files.delete(name); },
  };
  return { storage, files, previous };
}

test('partial metadata writes and failed renames preserve the entire prior library', async () => {
  for (const failure of ['write', 'move'] as const) {
    const f = fixture(failure);
    assert.throws(() => publishIndexSnapshot(f.storage, [next]));
    assert.equal(f.files.get('index.json'), f.previous);
    assert.deepEqual([...f.files.keys()], ['index.json']);
    assert.deepEqual(await readIndexSnapshot(f.storage), [old]);
  }
});

test('a successful fresh-name publication becomes current before old snapshots are pruned', async () => {
  const f = fixture();
  publishIndexSnapshot(f.storage, [next]);
  assert.deepEqual([...f.files.keys()], ['index-000000000001.json']);
  assert.deepEqual(await readIndexSnapshot(f.storage), [next]);
  publishIndexSnapshot(f.storage, [old, next]);
  assert.deepEqual([...f.files.keys()], ['index-000000000002.json']);
  assert.deepEqual(await readIndexSnapshot(f.storage), [old, next]);
});

test('failed pruning and unfinished snapshot files do not hide the newly published index', async () => {
  const f = fixture('prune');
  publishIndexSnapshot(f.storage, [next]);
  f.files.set('index-000000000002.json.part', '[');
  assert.equal(f.files.get('index.json'), f.previous);
  assert.deepEqual(await readIndexSnapshot(f.storage), [next]);
});

test('legacy indexes remain readable and an invalid newest snapshot falls back', async () => {
  const f = fixture();
  assert.deepEqual(await readIndexSnapshot(f.storage), [old]);
  f.files.set('index-000000000009.json', '{broken');
  assert.deepEqual(await readIndexSnapshot(f.storage), [old]);
});
