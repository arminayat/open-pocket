import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranscriptionController } from '../src/lib/transcription/controller';
import { transcribe } from '../src/lib/transcription/engine';
import { ASSEMBLY_AUTO, discoverModels, knownModels, resolveModel, validModelId } from '../src/lib/transcription/models';
import { TranscriptionError } from '../src/lib/transcription/request';
import { parseTranscriptionCredentials, type TranscriptionCredentials } from '../src/lib/transcription/state';
import type { ProviderId, TranscribeOptions, TranscriptionUploadRequest } from '../src/lib/transcription/types';

const key = 'synthetic-private-key';
const signal = () => new AbortController().signal;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** Records each request and answers with the given body. */
function fetcher(body: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; method?: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, method: init.method });
    return json(body, status);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const ids = (models: { id: string }[]) => models.map(model => model.id);

test('OpenAI lists only file transcription models from the key, recommended first, with retirement notes', async () => {
  const { fetch, calls } = fetcher({ object: 'list', data: [
    { id: 'gpt-4o' }, { id: 'whisper-1', shutdown_date: 1803945600 }, { id: 'gpt-4o-transcribe-diarize' },
    { id: 'gpt-live-transcribe' }, { id: 'gpt-transcribe' }, { id: 'gpt-4o-mini-transcribe-2025-12-15' },
    { id: 'tts-1' }, { id: 'bad id with spaces transcribe' },
  ] });
  const models = await discoverModels('openai', key, fetch, signal());
  assert.deepEqual(ids(models), ['gpt-transcribe', 'whisper-1', 'gpt-4o-mini-transcribe-2025-12-15']);
  assert.equal(models[0].label, 'GPT Transcribe');
  assert.equal(models[1].note, 'Retires 2027-03-02');
  assert.deepEqual(calls.map(call => [call.method, call.url, call.headers.Authorization]),
    [['GET', 'https://api.openai.com/v1/models', `Bearer ${key}`]]);
});

test('Groq keeps active Whisper models; Deepgram keeps batch speech models once per canonical name', async () => {
  const groq = fetcher({ data: [{ id: 'whisper-large-v3', active: true }, { id: 'whisper-large-v3-turbo' },
    { id: 'distil-whisper-large-v3-en', active: false }, { id: 'llama-3.3-70b-versatile', active: true }] });
  assert.deepEqual(ids(await discoverModels('groq', key, groq.fetch, signal())), ['whisper-large-v3-turbo', 'whisper-large-v3']);
  assert.equal(groq.calls[0].url, 'https://api.groq.com/openai/v1/models');

  const deepgram = fetcher({ stt: [
    { canonical_name: 'nova-2-meeting', batch: true }, { canonical_name: 'nova-3', batch: true },
    { canonical_name: 'nova-3', batch: true }, { canonical_name: 'flux-general-en', batch: false, streaming: true },
  ], tts: [{ canonical_name: 'aura-2', batch: true }] });
  assert.deepEqual(ids(await discoverModels('deepgram', key, deepgram.fetch, signal())), ['nova-3', 'nova-2-meeting']);
  assert.equal(deepgram.calls[0].headers.Authorization, `Token ${key}`);
});

test('ElevenLabs and AssemblyAI verify the key, then offer their documented speech models', async () => {
  const eleven = fetcher([{ model_id: 'eleven_multilingual_v2' }]);
  assert.deepEqual(await discoverModels('elevenlabs', key, eleven.fetch, signal()), knownModels('elevenlabs'));
  assert.deepEqual([eleven.calls[0].url, eleven.calls[0].headers['xi-api-key']], ['https://api.elevenlabs.io/v1/models', key]);
  const assembly = fetcher({ transcripts: [] });
  assert.deepEqual(ids(await discoverModels('assemblyai', key, assembly.fetch, signal())), [ASSEMBLY_AUTO, 'universal-3-5-pro', 'universal-2']);
  assert.deepEqual([assembly.calls[0].url, assembly.calls[0].headers.Authorization], ['https://api.assemblyai.com/v2/transcript?limit=1', key]);
});

test('a rejected key, an unusable list, and invalid identifiers are reported without leaking the key', async () => {
  for (const provider of ['openai', 'groq', 'deepgram', 'elevenlabs', 'assemblyai'] as ProviderId[]) {
    await assert.rejects(discoverModels(provider, key, fetcher({ error: key }, 401).fetch, signal()),
      error => error instanceof TranscriptionError && error.code === 'authentication' && !error.message.includes(key));
  }
  await assert.rejects(discoverModels('openai', key, fetcher({ data: [{ id: 'gpt-4o' }] }).fetch, signal()), { code: 'invalid-response' });
  await assert.rejects(discoverModels('deepgram', key, fetcher({ stt: 'nope' }).fetch, signal()), { code: 'invalid-response' });
  for (const value of ['', ' nova-3', 'nova-3&callback=x', '../models', 'a'.repeat(101), 42]) assert.equal(validModelId(value), false);
  assert.equal(resolveModel('deepgram', 'nova-3&x=1'), 'nova-3');
  assert.equal(resolveModel('assemblyai', undefined), ASSEMBLY_AUTO);
});

test('the chosen model reaches each provider request, encoded where it enters a URL', async () => {
  const sent: TranscriptionUploadRequest[] = [];
  const upload = async (request: TranscriptionUploadRequest) => {
    sent.push(request);
    return { status: 200, body: JSON.stringify(request.url.includes('deepgram') ? { results: { channels: [{ alternatives: [{ transcript: 'Hi.' }] }] } } : { text: 'Hi.' }) };
  };
  const base = { key, uri: 'file:///recording.mp3', signal: signal(), onJob: async () => {}, onStage: () => {} };
  assert.deepEqual(await transcribe({ ...base, provider: 'openai', model: 'whisper-1' }, { upload, fetch: fetcher({}).fetch }), { text: 'Hi.', model: 'whisper-1' });
  await transcribe({ ...base, provider: 'deepgram', model: 'nova-2-meeting' }, { upload, fetch: fetcher({}).fetch });
  await transcribe({ ...base, provider: 'elevenlabs', model: 'scribe_v2_medical' }, { upload, fetch: fetcher({}).fetch });
  assert.equal(sent[0].parameters?.model, 'whisper-1');
  assert.match(sent[1].url, /^https:\/\/api\.deepgram\.com\/v1\/listen\?model=nova-2-meeting&/);
  assert.equal(sent[2].parameters?.model_id, 'scribe_v2_medical');
  await assert.rejects(transcribe({ ...base, provider: 'deepgram', model: 'nova-3&mip_opt_out=false' }, { upload, fetch: fetcher({}).fetch }), { code: 'invalid-request' });
  assert.equal(sent.length, 3);
});

test('AssemblyAI sends the chosen model alone, or its automatic fallback pair', async () => {
  const bodies: unknown[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (init.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return json({ id: 'job_1' }); }
    return json({ id: 'job_1', status: 'completed', text: 'Hi.', speech_model_used: 'universal-2' });
  }) as unknown as typeof globalThis.fetch;
  const upload = async () => ({ status: 200, body: JSON.stringify({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }) });
  const base: TranscribeOptions = { provider: 'assemblyai', key, uri: 'file:///recording.mp3', signal: signal(), onJob: async () => {}, onStage: () => {} };
  await transcribe({ ...base, model: 'universal-2' }, { upload, fetch });
  await transcribe({ ...base, model: ASSEMBLY_AUTO }, { upload, fetch });
  assert.deepEqual(bodies.map(body => (body as { speech_models: string[] }).speech_models), [['universal-2'], ['universal-3-5-pro', 'universal-2']]);
});

test('saved model choices survive restarts; older settings without models still load', () => {
  assert.deepEqual(parseTranscriptionCredentials(JSON.stringify({ selectedProvider: 'groq', keys: { groq: key } })).models, {});
  assert.deepEqual(parseTranscriptionCredentials(JSON.stringify({ selectedProvider: 'groq', keys: {}, models: { groq: 'whisper-large-v3' } })).models,
    { groq: 'whisper-large-v3' });
  assert.throws(() => parseTranscriptionCredentials(JSON.stringify({ selectedProvider: 'groq', keys: {}, models: { groq: 'x y' } })));
  assert.throws(() => parseTranscriptionCredentials(JSON.stringify({ selectedProvider: 'groq', keys: {}, models: { other: 'whisper-1' } })));
});

test('the controller checks a saved key, keeps documented models after failures, and transcribes with the choice', async () => {
  let stored: TranscriptionCredentials = { selectedProvider: 'groq', keys: { groq: key } };
  let answer: () => Promise<{ id: string; label: string }[]> = async () => [{ id: 'whisper-large-v3', label: 'Whisper Large v3' }];
  const sent: TranscribeOptions[] = [];
  const client = createTranscriptionController({
    loadCredentials: async () => structuredClone(stored), saveCredentials: async value => { stored = structuredClone(value); },
    loadEntries: async () => ({}), saveEntries: async () => {}, checkRecording: () => {}, registerSecret: () => () => {},
    listModels: () => answer(),
    transcribe: async options => { sent.push(options); return { text: 'Hi.', model: options.model! }; },
  });
  await client.load();
  assert.equal(client.snapshot().selectedModels.groq, 'whisper-large-v3-turbo');
  await client.refreshModels('groq');
  assert.deepEqual(client.snapshot().modelLists.groq, { status: 'ready', models: [{ id: 'whisper-large-v3', label: 'Whisper Large v3' }] });
  await client.selectModel('groq', 'whisper-large-v3');
  assert.equal(stored.models?.groq, 'whisper-large-v3');
  answer = async () => { throw new TranscriptionError('authentication'); };
  await client.refreshModels('groq');
  assert.equal(client.snapshot().modelLists.groq?.status, 'rejected');
  answer = async () => { throw new TranscriptionError('network'); };
  await client.refreshModels('groq');
  assert.deepEqual(client.snapshot().modelLists.groq, { status: 'failed', models: knownModels('groq') });
  await client.start({ id: 'r1', date: '2026-10-29', timestamp: '20261029134905', durationSeconds: 8,
    uri: 'file:///Documents/recordings/r1.mp3', bytes: 1000, transport: 'bluetooth', downloadedAt: '2026-10-29T13:50:00.000Z' });
  assert.equal(sent[0].model, 'whisper-large-v3');
  assert.equal(JSON.stringify(client.snapshot()).includes(key), false);
});
