import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranscriptionController } from '../src/lib/transcription/controller';
import { transcribe } from '../src/lib/transcription/engine';
import { parseTranscripts, recordingKey, resumableJob, type TranscriptEntry, type TranscriptionCredentials } from '../src/lib/transcription/state';
import { readSnapshot, type IndexStorage } from '../src/storage/index-snapshots';
import type { LocalRecording } from '../src/lib/pocket/types';
import type { TranscribeOptions, TranscriptionResult } from '../src/lib/transcription/types';

const recording: LocalRecording = {
  id: '2026-10-23/20261023120000', date: '2026-10-23', timestamp: '20261023120000', durationSeconds: 60,
  uri: 'file:///app/Documents/recordings/review.mp3', bytes: 1234,
  transport: 'bluetooth', downloadedAt: '2026-10-23T12:00:00Z',
};
const key = recordingKey(recording);

function fixture(loadEntries: () => Promise<Record<string, TranscriptEntry>>) {
  let credentials: TranscriptionCredentials = {
    selectedProvider: 'openai', keys: { openai: 'synthetic-openai', assemblyai: 'synthetic-assembly' },
  };
  let persisted: Record<string, TranscriptEntry> = {};
  let requests = 0;
  let work: (options: TranscribeOptions) => Promise<TranscriptionResult> = async () => ({ text: 'Transcript', model: 'test' });
  const client = createTranscriptionController({
    loadCredentials: async () => structuredClone(credentials),
    listModels: async () => [],
    saveCredentials: async value => { credentials = structuredClone(value); },
    loadEntries, saveEntries: async value => { persisted = structuredClone(value); },
    registerSecret: () => () => {}, checkRecording() {},
    transcribe: async options => { requests++; return work(options); },
  });
  return { client, setWork: (next: typeof work) => { work = next; },
    requests: () => requests, persisted: () => persisted };
}

function storage(files: Record<string, string>): IndexStorage {
  return { list: () => Object.keys(files), read: async name => files[name], write() {}, move() {}, remove() {} };
}

test('unreadable latest transcript snapshot fails closed even if an older empty snapshot is readable', async () => {
  const saved = storage({ 'index-000000000001.json': '[]', 'index-000000000002.json': '{unreadable' });
  const f = fixture(() => readSnapshot(saved, parseTranscripts, {}));
  await f.client.load();
  assert.match(f.client.snapshot().error!, /could not be read/);
  await f.client.start(recording, 'openai');
  assert.equal(f.requests(), 0);
});

test('unfinished part snapshot does not hide the last committed transcript snapshot', async () => {
  const saved = storage({ 'index-000000000001.json': '[]', 'index-000000000002.json.part': '{unfinished' });
  const f = fixture(() => readSnapshot(saved, parseTranscripts, {}));
  await f.client.load();
  assert.equal(f.client.snapshot().error, null);
  await f.client.start(recording, 'openai');
  assert.equal(f.requests(), 1);
  assert.equal(f.client.snapshot().entries[key].status, 'complete');
});

test('a missing AssemblyAI job allows a confirmed fresh request using the newly selected provider', async () => {
  const initial: TranscriptEntry = { recordingKey: key, provider: 'assemblyai', status: 'pending',
    jobId: 'expired-job', updatedAt: '2026-10-23T12:00:00Z' };
  const f = fixture(async () => ({ [key]: initial }));
  const requests: string[] = [];
  f.setWork(options => transcribe(options, {
    fetch: async (input, init) => {
      requests.push(`${init?.method} ${input}`);
      return new Response('{"error":"private synthetic provider detail"}', { status: 404 });
    },
    upload: async request => {
      requests.push(`UPLOAD ${request.url}`);
      return { status: 200, body: '{"text":"New transcript"}' };
    },
  }));
  await f.client.load();
  await f.client.start(recording, 'assemblyai');
  const expired = f.client.snapshot().entries[key];
  assert.equal(expired.errorCode, 'job-not-found');
  assert.equal(resumableJob(expired), false);
  assert.equal(f.persisted()[key].errorCode, 'job-not-found');
  await f.client.selectProvider('openai');
  await f.client.start(recording, 'openai');
  assert.deepEqual(requests, [
    'GET https://api.assemblyai.com/v2/transcript/expired-job',
    'UPLOAD https://api.openai.com/v1/audio/transcriptions',
  ]);
  assert.equal(f.client.snapshot().entries[key].text, 'New transcript');
});

test('missing-key preflight errors cannot resurrect terminal provider jobs', async () => {
  for (const errorCode of ['job-not-found', 'job-failed']) {
    const initial: TranscriptEntry = { recordingKey: key, provider: 'assemblyai', status: 'error',
      jobId: 'terminal-job', errorCode, updatedAt: '2026-10-23T12:00:00Z' };
    const f = fixture(async () => ({ [key]: structuredClone(initial) }));
    await f.client.load();
    await f.client.removeKey('openai');
    await f.client.start(recording, 'openai');
    assert.match(f.client.snapshot().error!, /OpenAI API key/);
    assert.deepEqual(f.client.snapshot().entries[key], initial);
    assert.equal(resumableJob(f.client.snapshot().entries[key]), false);
    assert.equal(f.requests(), 0);
    assert.deepEqual(f.persisted(), {});
  }
});
