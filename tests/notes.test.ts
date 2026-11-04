import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotesController } from '../src/lib/notes/controller';
import { compareNoteEntries, MAX_NOTE_LENGTH, parseNotes, type NoteEntry } from '../src/lib/notes/state';
import type { LocalRecording } from '../src/lib/pocket/types';
import { recordingKey } from '../src/lib/transcription/state';
import { readSnapshot, type IndexStorage } from '../src/storage/index-snapshots';

const recording: LocalRecording = {
  id: '2026-10-23/20261023120000', date: '2026-10-23', timestamp: '20261023120000', durationSeconds: 120,
  uri: 'file:///container/Documents/recordings/example.mp3', bytes: 1234,
  transport: 'bluetooth', downloadedAt: '2026-10-23T12:00:00Z',
};
const key = recordingKey(recording);
const entry = (text = 'A note', suffix = '1', updatedAt = '2026-10-23T12:00:00.000Z'): NoteEntry => ({
  recordingKey: key, text, updatedAt, revision: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
});

function fixture(initial: NoteEntry[] = []) {
  let stored = parseNotes(initial);
  let failSave = false;
  let failLoad = false;
  let revision = 10;
  let writes = 0;
  let beforeSave: (() => Promise<void>) | undefined;
  const create = () => createNotesController({
    loadEntries: async () => { if (failLoad) throw new Error('corrupt'); return structuredClone(stored); },
    saveEntries: async next => {
      writes++;
      await beforeSave?.();
      if (failSave) throw new Error('disk full');
      stored = structuredClone(next);
    },
    revision: () => entry('', String(revision++)).revision,
    now: () => Date.parse('2026-10-23T13:00:00.000Z'),
  });
  return { create, getStored: () => stored, getWrites: () => writes,
    failSave: (value: boolean) => { failSave = value; }, failLoad: () => { failLoad = true; },
    beforeSave: (work: () => Promise<void>) => { beforeSave = work; } };
}

test('note edits persist relative identity, new revisions, and deliberate empty values', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  assert.equal(await client.save(recording, '  My own note\n  ', null), true);
  const first = client.snapshot().entries[key];
  assert.equal(first.text, '  My own note\n  ');
  assert.equal(first.recordingKey.includes('container'), false);
  assert.equal(await client.save(recording, '', first.revision), true);
  const cleared = client.snapshot().entries[key];
  assert.equal(cleared.text, '');
  assert.notEqual(cleared.revision, first.revision);
  assert.ok(compareNoteEntries(cleared, first) > 0);
  const restarted = f.create(); await restarted.load();
  assert.deepEqual(restarted.snapshot().entries[key], cleared);
  assert.equal(await restarted.save(recording, '', cleared.revision), true);
  assert.equal(f.getWrites(), 2, 'unchanged text does not manufacture a revision');
});

test('failed publication preserves the previous saved note and allows retry of the draft', async () => {
  const previous = entry(); const f = fixture([previous]); const client = f.create(); await client.load();
  f.failSave(true);
  assert.equal(await client.save(recording, 'My unsaved draft', previous.revision), false);
  assert.deepEqual(client.snapshot().entries[key], previous);
  assert.deepEqual(f.getStored()[key], previous);
  assert.match(client.snapshot().error!, /draft is still here/);
  f.failSave(false);
  assert.equal(await client.save(recording, 'My unsaved draft', previous.revision), true);
  assert.equal(client.snapshot().entries[key].text, 'My unsaved draft');
});

test('a synced note prevents an open draft from overwriting an unseen revision', async () => {
  const initial = entry(); const f = fixture([initial]); const client = f.create(); await client.load();
  const synced = entry('Edited on another device', '2', '2026-10-23T12:30:00.000Z');
  await client.merge([synced]);
  assert.equal(await client.save(recording, 'Draft based on old text', initial.revision), false);
  assert.deepEqual(client.snapshot().entries[key], synced);
  assert.match(client.snapshot().error!, /changed while you were editing/);
  assert.equal(await client.save(recording, 'My reviewed draft', synced.revision), true);
  assert.equal(client.snapshot().entries[key].text, 'My reviewed draft');
  const newer = fixture(); const other = newer.create(); await other.load(); await other.merge([synced]);
  assert.equal(await other.save(recording, 'Draft started before first sync', null), false);
});

test('a local edit made during sync survives until a later run can archive it', async () => {
  const initial = entry(); const f = fixture([initial]); const client = f.create(); await client.load();
  const expected = { [key]: initial.revision };
  assert.equal(await client.save(recording, 'Edited while the sync was uploading', initial.revision), true);
  const local = client.snapshot().entries[key];
  const futureRemote = entry('Cloud version with a later timestamp', '3', '2030-01-01T00:00:00.000Z');
  await assert.rejects(client.merge([futureRemote], expected), /local note changed during sync/);
  assert.deepEqual(client.snapshot().entries[key], local);
  await assert.rejects(client.merge([futureRemote], { [key]: null }), /changed during sync/);
  await client.merge([futureRemote], { [key]: local.revision });
  assert.deepEqual(client.snapshot().entries[key], futureRemote);
});

test('local edits advance a future-dated synced version when clocks disagree', async () => {
  const future = entry('Future device clock', '1', '2030-01-01T00:00:00.000Z');
  const f = fixture([future]); const client = f.create(); await client.load();
  assert.equal(await client.save(recording, 'New local edit', future.revision), true);
  assert.equal(client.snapshot().entries[key].updatedAt, '2030-01-01T00:00:00.001Z');
});

test('note merges converge by timestamp then revision, including an intentional clearing', async () => {
  const a = entry('A', '1'); const b = entry('', '2');
  const f = fixture([a]); const g = fixture([b]);
  const first = f.create(); const second = g.create(); await first.load(); await second.load();
  await first.merge([b]); await second.merge([a]);
  assert.deepEqual(first.snapshot().entries, second.snapshot().entries);
  assert.equal(first.snapshot().entries[key].text, '');
  assert.equal(g.getWrites(), 0);
  await first.merge([b]); assert.equal(f.getWrites(), 1);
  await assert.rejects(first.merge([{ ...b, text: 'Changed contents of immutable version' }]), /conflicting contents/);
  assert.equal(first.snapshot().entries[key].text, '');
});

test('save and merge serialize publication and never expose data before it is durable', async () => {
  const initial = entry(); const f = fixture([initial]); const client = f.create(); await client.load();
  let resolve!: () => void;
  f.beforeSave(() => new Promise<void>(r => { resolve = r; }));
  const pending = client.save(recording, 'Saving', initial.revision);
  assert.equal(client.snapshot().saving, true);
  assert.deepEqual(client.snapshot().entries[key], initial);
  assert.equal(await client.save(recording, 'Duplicate', initial.revision), false);
  await assert.rejects(client.merge([entry('From sync', '2')]), /being saved/);
  resolve(); assert.equal(await pending, true);
  assert.equal(f.getWrites(), 1);
  const merge = client.merge([entry('Newer cloud text', '3', '2026-10-23T15:00:00.000Z')]);
  assert.equal(client.snapshot().saving, true);
  assert.equal(await client.save(recording, 'Racing edit'), false);
  resolve(); await merge;
  assert.equal(client.snapshot().entries[key].text, 'Newer cloud text');
});

test('load and merge failures preserve saved data and never silently accept changes', async () => {
  const f = fixture([entry()]); f.failLoad(); const client = f.create(); await client.load();
  assert.equal(await client.save(recording, 'Unsafe'), false);
  await assert.rejects(client.merge([entry('Unsafe')]), /could not be read/);
  assert.equal(f.getWrites(), 0);
  const g = fixture([entry()]); const other = g.create(); await other.load(); g.failSave(true);
  await assert.rejects(other.merge([entry('New', '2')]), /could not be saved/);
  assert.equal(other.snapshot().entries[key].text, 'A note');
});

test('invalid imported notes and excessive edits are rejected without publication', async () => {
  const initial = entry();
  for (const invalid of [null, { ...initial, text: 42 }, { ...initial, text: 'a'.repeat(MAX_NOTE_LENGTH + 1) },
    { ...initial, revision: '../unsafe' }, { ...initial, updatedAt: 'invalid' },
    { ...initial, recordingKey: '["a","../unsafe.mp3",3]' }, { ...initial, recordingKey: '["a","ok.mp3",0]' }]) {
    assert.throws(() => parseNotes([invalid]));
  }
  assert.throws(() => parseNotes([initial, initial]), /Duplicate/);
  assert.deepEqual(parseNotes([{ ...initial, arbitrary: 'not persisted' }])[key], initial);
  const f = fixture(); const client = f.create(); await client.load();
  assert.equal(await client.save(recording, 'a'.repeat(MAX_NOTE_LENGTH + 1)), false);
  assert.equal(f.getWrites(), 0);
  assert.equal(await client.save({ ...recording, bytes: 0 }, 'invalid identity'), false);
  assert.equal(f.getWrites(), 0);
});

test('latest corrupted note snapshot blocks writes rather than reviving stale text', async () => {
  const storage: IndexStorage = {
    list: () => ['index-000000000001.json', 'index-000000000002.json'],
    read: async name => name.endsWith('2.json') ? 'broken' : JSON.stringify([entry('Old')]),
    write() { throw new Error('unexpected write'); }, move() {}, remove() {},
  };
  await assert.rejects(readSnapshot(storage, parseNotes, {}), /latest saved snapshot/);
});
