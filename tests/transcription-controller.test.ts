import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranscriptionController } from '../src/lib/transcription/controller';
import { parseTranscriptionCredentials, parseTranscripts, recordingKey } from '../src/lib/transcription/state';
import type { TranscriptionCredentials, TranscriptEntry } from '../src/lib/transcription/state';
import type { TranscribeOptions, TranscriptionResult } from '../src/lib/transcription/types';
import type { LocalRecording } from '../src/lib/pocket/types';
import { TranscriptionError } from '../src/lib/transcription/request';

const recording: LocalRecording = {
  id: '2026-10-23/20261023120000', date: '2026-10-23', timestamp: '20261023120000', durationSeconds: 120,
  uri: 'file:///container/Documents/recordings/example.mp3', bytes: 1234,
  transport: 'bluetooth', downloadedAt: '2026-10-23T12:00:00Z',
};

function fixture() {
  let storedCredentials: TranscriptionCredentials = { selectedProvider: 'openai', keys: { openai: 'synthetic-private-key' } };
  let storedEntries: Record<string, TranscriptEntry> = {};
  let failCredentials = false;
  let failEntries = false;
  let failLoad = false;
  let fileMissing = false;
  const calls: TranscribeOptions[] = [];
  const secrets = new Set<string>();
  let work: (options: TranscribeOptions) => Promise<TranscriptionResult> = async () => ({ text: 'A test transcript.', model: 'test-model' });
  const create = () => createTranscriptionController({
    loadCredentials: async () => structuredClone(storedCredentials),
    listModels: async () => [],
    saveCredentials: async value => { if (failCredentials) throw new Error('secret provider error'); storedCredentials = structuredClone(value); },
    loadEntries: async () => { if (failLoad) throw new Error('corrupt'); return structuredClone(storedEntries); },
    saveEntries: async value => { if (failEntries) throw new Error('full'); storedEntries = structuredClone(value); },
    checkRecording: () => { if (fileMissing) throw new Error('file details'); },
    registerSecret: key => { secrets.add(key); return () => { secrets.delete(key); }; },
    transcribe: async options => { calls.push(options); return work(options); },
  });
  return { create, calls, secrets, getCredentials: () => storedCredentials, getEntries: () => storedEntries,
    setWork: (value: typeof work) => { work = value; },
    failCredentials: (value: boolean) => { failCredentials = value; },
    failEntries: (value: boolean) => { failEntries = value; },
    failLoad: () => { failLoad = true; }, fileMissing: () => { fileMissing = true; } };
}

test('BYOK mutations remain independent, private, and do not upload audio', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  assert.equal(await client.saveKey('groq', '  another-private-key  '), true);
  assert.equal(f.getCredentials().keys.groq, 'another-private-key');
  assert.deepEqual(client.snapshot().savedProviders, ['openai', 'groq']);
  assert.equal(JSON.stringify(client.snapshot()).includes('private-key'), false);
  await client.removeKey('openai');
  assert.deepEqual(client.snapshot().savedProviders, ['groq']);
  assert.equal(f.calls.length, 0);
  f.failCredentials(true);
  assert.equal(await client.saveKey('groq', 'replacement-key'), false);
  assert.equal(f.getCredentials().keys.groq, 'another-private-key');
  assert.equal(client.snapshot().error?.includes('secret provider error'), false);
  assert.equal(await client.saveKey('groq', 'invalid\nkey'), false);
});

test('preflight key, exact-file, and provider limits stop all uploads', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  await client.selectProvider('deepgram');
  await client.start(recording);
  assert.match(client.snapshot().error!, /Deepgram API key/);
  await client.selectProvider('openai');
  await client.start(recording, 'groq');
  assert.match(client.snapshot().error!, /provider changed/);
  await client.start({ ...recording, bytes: 25_000_001 });
  assert.match(client.snapshot().error!, /upload limit/);
  f.fileMissing(); await client.start(recording);
  assert.match(client.snapshot().error!, /missing or has changed/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.getEntries(), {});
});

test('duplicate starts and settings changes are blocked while one request is active', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  let resolve!: (result: TranscriptionResult) => void;
  let started!: () => void;
  const waiting = new Promise<void>(r => { started = r; });
  f.setWork(() => { started(); return new Promise(r => { resolve = r; }); });
  const first = client.start(recording); await waiting;
  await assert.rejects(client.mergeTranscript(recording, {
    schema: 1, kind: 'transcript', provider: 'openai', model: 'gpt-transcribe',
    text: 'Cloud text must wait', updatedAt: '2026-10-23T12:00:00.000Z',
  }), /busy/);
  await client.start(recording); await client.start({ ...recording, id: 'another' });
  await client.removeKey('openai'); await client.selectProvider('groq');
  assert.equal(f.calls.length, 1);
  assert.equal(f.getCredentials().selectedProvider, 'openai');
  assert.ok(f.getCredentials().keys.openai);
  assert.equal(f.getEntries()[recordingKey(recording)].status, 'pending');
  resolve({ text: 'Result', model: 'test' }); await first;
  assert.equal(client.snapshot().entries[recordingKey(recording)].text, 'Result');
  await client.start(recording); assert.equal(f.calls.length, 1);
});

test('interrupted AssemblyAI resumes its original provider job after restart and settings changes', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  await client.saveKey('assemblyai', 'assembly-key');
  f.setWork(async options => { await options.onJob('saved-job'); throw new TranscriptionError('network'); });
  await client.start(recording);
  assert.equal(f.getEntries()[recordingKey(recording)].jobId, 'saved-job');
  const restarted = f.create(); await restarted.load(); await restarted.selectProvider('openai');
  f.setWork(async options => {
    assert.equal(options.jobId, 'saved-job'); assert.equal(options.provider, 'assemblyai');
    assert.equal(options.key, 'assembly-key');
    return { text: 'Recovered result', model: 'universal-3-5-pro' };
  });
  await restarted.start(recording);
  assert.equal(f.calls.length, 2);
  assert.equal(restarted.snapshot().entries[recordingKey(recording)].text, 'Recovered result');
});

test('accepted job stays in memory on storage failure and must be saved before resume', async () => {
  const f = fixture(); const client = f.create(); await client.load(); await client.saveKey('assemblyai', 'key');
  f.setWork(async options => {
    f.failEntries(true);
    try { await options.onJob('accepted-job'); } catch { throw new TranscriptionError('persist-job'); }
    throw new Error('unreachable');
  });
  await client.start(recording);
  assert.equal(client.snapshot().entries[recordingKey(recording)].jobId, 'accepted-job');
  await client.start(recording); assert.equal(f.calls.length, 1);
  f.failEntries(false);
  f.setWork(async options => {
    assert.equal(options.jobId, 'accepted-job');
    assert.equal(f.getEntries()[recordingKey(recording)].jobId, 'accepted-job');
    return { text: 'Recovered', model: 'test' };
  });
  await client.start(recording); assert.equal(f.calls.length, 2);
});

test('completed transcript remains viewable after save failure and saving again makes no API call', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  f.setWork(async () => { f.failEntries(true); return { text: 'Keep this result', model: 'test' }; });
  await client.start(recording);
  const entry = client.snapshot().entries[recordingKey(recording)];
  assert.equal(entry.status, 'complete'); assert.equal(entry.text, 'Keep this result'); assert.equal(entry.unsaved, true);
  f.failEntries(false); await client.start(recording);
  assert.equal(f.calls.length, 1); assert.equal(client.snapshot().entries[recordingKey(recording)].unsaved, false);
  assert.equal(f.getEntries()[recordingKey(recording)].text, 'Keep this result');
});

test('load or intent-publication failures prevent billable work', async () => {
  const f = fixture(); f.failLoad(); const client = f.create(); await client.load(); await client.start(recording);
  assert.equal(f.calls.length, 0);
  const g = fixture(); const other = g.create(); await other.load(); g.failEntries(true); await other.start(recording);
  assert.equal(g.calls.length, 0);
});

test('cancel is forwarded once and no request automatically retries', async () => {
  const f = fixture(); const client = f.create(); await client.load();
  let started!: () => void; const waiting = new Promise<void>(r => { started = r; });
  f.setWork(options => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new TranscriptionError('cancelled')), { once: true }); started();
  }));
  const work = client.start(recording); await waiting; client.cancel(); client.cancel(); await work;
  assert.equal(f.calls.length, 1); assert.equal(client.snapshot().active, null);
  assert.match(client.snapshot().error!, /may still process and charge/);
});

test('identity follows the exact local copy across container changes; parsers reject unsafe state', () => {
  assert.equal(recordingKey(recording), recordingKey({ ...recording, uri: recording.uri.replace('container', 'new-container') }));
  assert.notEqual(recordingKey(recording), recordingKey({ ...recording, bytes: 1235 }));
  assert.notEqual(recordingKey(recording), recordingKey({ ...recording, uri: recording.uri.replace('example', 'replacement') }));
  assert.throws(() => parseTranscriptionCredentials('{"selectedProvider":"other","keys":{}}'));
  assert.throws(() => parseTranscriptionCredentials('{"selectedProvider":"groq","keys":{"groq":"bad\\nkey"}}'));
  const entry = { recordingKey: recordingKey(recording), provider: 'assemblyai', status: 'pending', jobId: 'id', updatedAt: new Date().toISOString() };
  assert.equal(Object.keys(parseTranscripts([entry])).length, 1);
  assert.throws(() => parseTranscripts([{ ...entry, jobId: '../escape' }]));
  assert.throws(() => parseTranscripts([{ ...entry, provider: 'openai' }]));
  assert.throws(() => parseTranscripts([{ ...entry, status: 'complete' }]));
});
