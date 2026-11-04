import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranscriptionController } from '../src/lib/transcription/controller';
import { recordingKey, type TranscriptEntry } from '../src/lib/transcription/state';
import type { LocalRecording } from '../src/lib/pocket/types';
import type { TranscriptArtifact } from '../src/lib/icloud/types';

const recording: LocalRecording = {
  id: '2026-10-23/20261023120000', date: '2026-10-23', timestamp: '20261023120000', durationSeconds: 120,
  uri: `file:///container/Documents/recordings/icloud_${'a'.repeat(64)}.mp3`, bytes: 1234,
  transport: 'icloud', downloadedAt: '2026-10-23T12:00:00Z',
};
const key = recordingKey(recording);
const artifact: TranscriptArtifact = {
  schema: 1, kind: 'transcript', provider: 'openai', text: 'Synced transcript',
  model: 'gpt-transcribe', updatedAt: '2026-10-23T12:00:00.000Z',
};
const complete: TranscriptEntry = {
  recordingKey: key, status: 'complete', provider: artifact.provider,
  text: artifact.text, model: artifact.model, updatedAt: artifact.updatedAt,
};

function fixture(initial?: TranscriptEntry, credentialsFail = false, entriesFail = false) {
  let stored: Record<string, TranscriptEntry> = initial ? { [key]: initial } : {};
  let failSave = false;
  let beforeSave: (() => Promise<void>) | undefined;
  let writes = 0;
  const client = createTranscriptionController({
    loadCredentials: async () => { if (credentialsFail) throw new Error('Keychain locked'); return { selectedProvider: 'openai', keys: {} }; },
    listModels: async () => [],
    saveCredentials: async () => { throw new Error('Unexpected credential mutation'); },
    loadEntries: async () => { if (entriesFail) throw new Error('Unreadable'); return structuredClone(stored); },
    saveEntries: async next => {
      writes++;
      await beforeSave?.();
      if (failSave) throw new Error('disk full');
      stored = structuredClone(next);
    },
    checkRecording: () => { throw new Error('No audio check needed for imported text'); },
    transcribe: async () => { throw new Error('No paid calls permitted'); },
    registerSecret: () => () => {},
  });
  return { client, getStored: () => stored, getWrites: () => writes,
    failSave: () => { failSave = true; }, beforeSave: (value: () => Promise<void>) => { beforeSave = value; } };
}

test('cloud transcript imports require no API key or accessible credentials', async () => {
  for (const credentialsFail of [false, true]) {
    const f = fixture(undefined, credentialsFail); await f.client.load();
    await f.client.mergeTranscript(recording, artifact);
    assert.deepEqual(f.client.snapshot().entries[key], complete);
    assert.deepEqual(f.getStored()[key], complete);
    assert.deepEqual(f.client.snapshot().savedProviders, []);
  }
});

test('transcript import rejects unreadable source state and pending jobs or unsaved results', async () => {
  const unreadable = fixture(undefined, false, true); await unreadable.client.load();
  await assert.rejects(unreadable.client.mergeTranscript(recording, artifact), /could not be read/);
  for (const initial of [
    { ...complete, status: 'pending' as const },
    { ...complete, status: 'error' as const, provider: 'assemblyai' as const, jobId: 'known-job', errorCode: 'network' },
    { ...complete, unsaved: true },
  ]) {
    const f = fixture(initial); await f.client.load();
    await assert.rejects(f.client.mergeTranscript(recording, artifact), /unfinished or unsaved/);
    assert.deepEqual(f.client.snapshot().entries[key], initial);
    assert.equal(f.getWrites(), 0);
  }
});

test('completed transcript merge converges with the cloud payload tie-breaker', async () => {
  const f = fixture(complete); await f.client.load();
  await f.client.mergeTranscript(recording, { ...artifact, text: 'Older', updatedAt: '2026-10-22T12:00:00.000Z' });
  await f.client.mergeTranscript(recording, { ...artifact, text: 'A lower payload' });
  assert.equal(f.getWrites(), 0);
  await f.client.mergeTranscript(recording, { ...artifact, text: 'Z higher payload' });
  assert.equal(f.client.snapshot().entries[key].text, 'Z higher payload');
  await f.client.mergeTranscript(recording, artifact);
  assert.equal(f.getWrites(), 1);
  await f.client.mergeTranscript(recording, { ...artifact, text: 'Newer text', updatedAt: '2026-10-24T12:00:00.000Z' });
  assert.equal(f.client.snapshot().entries[key].text, 'Newer text');
});

test('failed import publication retains the existing transcript', async () => {
  const f = fixture(complete); await f.client.load(); f.failSave();
  await assert.rejects(f.client.mergeTranscript(recording, { ...artifact, updatedAt: '2026-10-24T12:00:00.000Z' }), /could not be saved/);
  assert.deepEqual(f.client.snapshot().entries[key], complete);
  assert.deepEqual(f.getStored()[key], complete);
});

test('a changed local transcript is preserved until a subsequent sync can archive it', async () => {
  const f = fixture(complete); await f.client.load();
  const captured = structuredClone(complete);
  const changed = { ...artifact, text: 'Completed while sync was uploading', updatedAt: '2026-10-24T12:00:00.000Z' };
  await f.client.mergeTranscript(recording, changed);
  const current = f.client.snapshot().entries[key];
  const remote = { ...artifact, text: 'Remote version', updatedAt: '2030-01-01T00:00:00.000Z' };
  await assert.rejects(f.client.mergeTranscript(recording, remote, captured), /local transcript changed during sync/);
  await assert.rejects(f.client.mergeTranscript(recording, remote, null), /changed during sync/);
  assert.deepEqual(f.client.snapshot().entries[key], current);
  await f.client.mergeTranscript(recording, remote, structuredClone(current));
  assert.equal(f.client.snapshot().entries[key].text, remote.text);
  const empty = fixture(); await empty.client.load();
  await empty.client.mergeTranscript(recording, artifact, null);
  assert.deepEqual(empty.client.snapshot().entries[key], complete);
});

test('import publication is serialized and state only changes after successful storage', async () => {
  const f = fixture();
  await assert.rejects(f.client.mergeTranscript(recording, artifact), /busy/);
  await f.client.load();
  let resolve!: () => void;
  f.beforeSave(() => new Promise<void>(r => { resolve = r; }));
  const first = f.client.mergeTranscript(recording, artifact);
  assert.equal(f.client.snapshot().saving, true);
  assert.equal(f.client.snapshot().entries[key], undefined);
  await assert.rejects(f.client.mergeTranscript(recording, artifact), /busy/);
  await f.client.start(recording);
  assert.equal(f.getWrites(), 1);
  resolve(); await first;
  assert.equal(f.client.snapshot().entries[key].text, artifact.text);
});

test('malformed cloud text is rejected and only completed safe fields are imported', async () => {
  const f = fixture(); await f.client.load();
  for (const invalid of [
    { ...artifact, provider: 'invalid' }, { ...artifact, schema: 2 },
    { ...artifact, model: 'line\nbreak' }, { ...artifact, text: 42 },
    { ...artifact, updatedAt: '2026-10-23' }, { ...artifact, text: 'x'.repeat(2_000_001) },
  ]) await assert.rejects(f.client.mergeTranscript(recording, invalid as TranscriptArtifact), /invalid/);
  assert.equal(f.getWrites(), 0);
  await f.client.mergeTranscript(recording, { ...artifact, apiKey: 'must-not-persist', jobId: 'must-not-persist' } as TranscriptArtifact);
  assert.deepEqual(f.getStored()[key], complete);
});
