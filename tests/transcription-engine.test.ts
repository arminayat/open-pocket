import assert from 'node:assert/strict';
import test from 'node:test';
import { transcribe } from '../src/lib/transcription/engine';
import { getTranscriptionProvider, isProviderId, TRANSCRIPTION_PROVIDERS, validateTranscriptionFile } from '../src/lib/transcription/providers';
import { assertTrustedTranscriptionUrl, parseTranscriptionJson, TranscriptionError, transcriptionJsonRequest } from '../src/lib/transcription/request';
import type { ProviderId, TranscribeOptions, TranscriptionTransport, TranscriptionUploadRequest } from '../src/lib/transcription/types';

const options = (provider: ProviderId, overrides: Partial<TranscribeOptions> = {}): TranscribeOptions => ({
  provider, key: 'synthetic-private-key', uri: 'file:///recording.mp3', signal: new AbortController().signal,
  onJob: async () => {}, onStage: () => {}, ...overrides,
});
const unexpectedFetch: typeof fetch = async () => { throw new Error('Unexpected request'); };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const transport = (body: unknown, status = 200): TranscriptionTransport => ({
  upload: async () => ({ status, body: JSON.stringify(body) }), fetch: unexpectedFetch,
});
const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error =>
  error instanceof TranscriptionError && error.code === code && !error.message.includes('synthetic-private-key'));

test('five providers have fixed models, key links and conservative direct upload limits', () => {
  assert.deepEqual(TRANSCRIPTION_PROVIDERS.map(provider => provider.id), ['openai', 'deepgram', 'assemblyai', 'elevenlabs', 'groq']);
  assert.equal(isProviderId('arbitrary'), false);
  assert.equal(isProviderId(null), false);
  assert.equal(isProviderId('groq'), true);
  for (const provider of TRANSCRIPTION_PROVIDERS) {
    assert.equal(new URL(provider.apiKeyUrl).protocol, 'https:');
    validateTranscriptionFile(provider.id, provider.maxBytes, provider.maxDurationSeconds);
    assert.throws(() => validateTranscriptionFile(provider.id, provider.maxBytes + 1), { code: 'file-too-large' });
  }
  assert.equal(getTranscriptionProvider('groq').maxBytes, 25_000_000);
  assert.throws(() => validateTranscriptionFile('assemblyai', 100, 36_001), { code: 'file-too-long' });
  assert.throws(() => validateTranscriptionFile('elevenlabs', 100, 36_001), { code: 'file-too-long' });
  assert.throws(() => validateTranscriptionFile('openai', 0), { code: 'unsupported-file' });
  assert.throws(() => validateTranscriptionFile('groq', NaN), { code: 'unsupported-file' });
});

test('OpenAI, Deepgram, ElevenLabs and Groq send their exact native upload contracts', async () => {
  const expected = {
    openai: { url: 'https://api.openai.com/v1/audio/transcriptions', parameters: { model: 'gpt-transcribe' } },
    deepgram: { url: 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&detect_language=true&mip_opt_out=true', parameters: undefined },
    elevenlabs: { url: 'https://api.elevenlabs.io/v1/speech-to-text', parameters: { model_id: 'scribe_v2', tag_audio_events: 'false', timestamps_granularity: 'none' } },
    groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', parameters: { model: 'whisper-large-v3-turbo', response_format: 'json' } },
  };
  for (const provider of ['openai', 'deepgram', 'elevenlabs', 'groq'] as const) {
    let calls = 0;
    const result = await transcribe(options(provider), {
      fetch: unexpectedFetch,
      upload: async request => {
        calls++;
        assert.equal(request.url, expected[provider].url);
        assert.deepEqual(request.parameters, expected[provider].parameters);
        assert.equal(request.uri, 'file:///recording.mp3');
        assert.equal(request.mimeType, 'audio/mpeg');
        assert.ok(request.signal instanceof AbortSignal);
        assert.equal(request.headers.Accept, 'application/json');
        if (provider === 'elevenlabs') {
          assert.equal(request.headers['xi-api-key'], 'synthetic-private-key');
          assert.equal(request.headers.Authorization, undefined);
        } else assert.equal(request.headers.Authorization, `${provider === 'deepgram' ? 'Token' : 'Bearer'} synthetic-private-key`);
        // Multipart boundaries must be set by native transport, never a bare Content-Type header.
        assert.equal(request.headers['Content-Type'], provider === 'deepgram' ? 'audio/mpeg' : undefined);
        const body = provider === 'deepgram' ? { results: { channels: [{ alternatives: [{ transcript: 'Hello.' }] }] } } : { text: 'Hello.' };
        return { status: 200, body: JSON.stringify(body) };
      },
    });
    assert.deepEqual(result, { text: 'Hello.', model: getTranscriptionProvider(provider).model });
    assert.equal(calls, 1);
  }
});

test('AssemblyAI uploads then submits once, persists its id before polling and returns actual fallback model', async () => {
  const events: string[] = [];
  const result = await transcribe(options('assemblyai', { onJob: async id => { assert.equal(id, 'job-123'); events.push('persist'); } }), {
    upload: async request => {
      events.push('upload');
      assert.equal(request.url, 'https://api.assemblyai.com/v2/upload');
      assert.equal(request.headers.Authorization, 'synthetic-private-key');
      assert.equal(request.headers['Content-Type'], 'application/octet-stream');
      assert.equal(request.parameters, undefined);
      return { status: 200, body: JSON.stringify({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }) };
    },
    fetch: async (input, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'synthetic-private-key');
      assert.equal(init?.redirect, 'error');
      if (init?.method === 'POST') {
        events.push('submit');
        assert.equal(input, 'https://api.assemblyai.com/v2/transcript');
        assert.deepEqual(JSON.parse(String(init.body)), {
          audio_url: 'https://cdn.assemblyai.com/upload/abc', speech_models: ['universal-3-5-pro', 'universal-2'], language_detection: true,
        });
        return json({ id: 'job-123', status: 'queued' });
      }
      events.push('poll');
      assert.equal(input, 'https://api.assemblyai.com/v2/transcript/job-123');
      return json({ id: 'job-123', status: 'completed', text: 'Hallo.', speech_model_used: 'universal-2' });
    },
  });
  assert.deepEqual(events, ['upload', 'submit', 'persist', 'poll']);
  assert.deepEqual(result, { text: 'Hallo.', model: 'universal-2' });
});

test('AssemblyAI resumes a saved job using GET only and accepts an empty no-speech transcript', async () => {
  let gets = 0;
  const result = await transcribe(options('assemblyai', {
    jobId: 'saved-job', onJob: async () => { assert.fail('Existing job must not be resubmitted'); },
  }), {
    upload: async () => { assert.fail('Existing job must not upload again'); },
    fetch: async (input, init) => {
      gets++;
      assert.equal(input, 'https://api.assemblyai.com/v2/transcript/saved-job');
      assert.equal(init?.method, 'GET');
      return json({ id: 'saved-job', status: 'completed', text: '', speech_model_used: 'universal-3-5-pro' });
    },
  });
  assert.equal(gets, 1);
  assert.equal(result.text, '');
  assert.equal(result.model, 'universal-3-5-pro');
});

test('AssemblyAI saves an accepted job when cancellation races with its submit response', async () => {
  const controller = new AbortController();
  const events: string[] = [];
  await rejectsCode(transcribe(options('assemblyai', {
    signal: controller.signal, onJob: async id => { events.push(`saved:${id}`); },
  }), {
    ...transport({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }),
    fetch: async (_input, init) => {
      events.push(init?.method ?? 'unknown');
      controller.abort();
      assert.equal(init?.signal?.aborted, false, 'An in-flight job submission must finish its bounded receipt');
      return json({ id: 'accepted-job', status: 'queued' });
    },
  }), 'cancelled');
  assert.deepEqual(events, ['POST', 'saved:accepted-job']);
});

test('cancellation before AssemblyAI job submission sends no billable POST', async () => {
  const controller = new AbortController();
  await rejectsCode(transcribe(options('assemblyai', {
    signal: controller.signal,
    onStage: stage => { if (stage === 'Starting transcription') controller.abort(); },
  }), {
    ...transport({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }), fetch: async () => { assert.fail('Cancelled before submit'); },
  }), 'cancelled');
});

test('persisting an AssemblyAI job is required before any polling', async () => {
  let fetches = 0;
  await rejectsCode(transcribe(options('assemblyai', {
    onJob: async () => { throw new Error('synthetic-private-key in unsafe storage error'); },
  }), {
    ...transport({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }),
    fetch: async (_input, init) => {
      fetches++;
      assert.equal(init?.method, 'POST');
      return json({ id: 'saved-job' });
    },
  }), 'persist-job');
  assert.equal(fetches, 1);
});

test('AssemblyAI rejects untrusted upload URLs, job paths and unexpected job status or identity', async () => {
  for (const upload_url of ['https://attacker.test/upload/abc', 'http://cdn.assemblyai.com/upload/abc',
    'https://cdn.assemblyai.com.attacker.test/upload/abc', 'https://key@cdn.assemblyai.com/upload/abc', 'https://cdn.assemblyai.com/other']) {
    await rejectsCode(transcribe(options('assemblyai'), transport({ upload_url })), 'invalid-response');
  }
  for (const jobId of ['', '../private', 'id?key=secret', 'a'.repeat(161)]) {
    await rejectsCode(transcribe(options('assemblyai', { jobId }), {
      upload: async () => { assert.fail('Invalid saved id must not create a new job'); }, fetch: unexpectedFetch,
    }), 'invalid-response');
  }
  for (const result of [{ status: 'unknown' }, { status: 'completed', text: null }, { id: 'other', status: 'completed', text: 'Hi' }]) {
    await rejectsCode(transcribe(options('assemblyai', { jobId: 'job' }), {
      ...transport(null), fetch: async () => json(result),
    }), 'invalid-response');
  }
  await rejectsCode(transcribe(options('assemblyai', { jobId: 'job' }), {
    ...transport(null), fetch: async () => json({ status: 'error', error: 'synthetic-private-key' }),
  }), 'job-failed');
});

test('AssemblyAI retains usable text when optional model provenance is absent or changed', async () => {
  for (const [reported, expected] of [
    [undefined, 'unknown'], [null, 'unknown'], ['', 'unknown'], ['   ', 'unknown'],
    ['universal-3-5-pro', 'universal-3-5-pro'], ['universal-2', 'universal-2'], ['future-model', 'future-model'],
    ['a'.repeat(101), 'unknown'],
  ]) {
    const result = await transcribe(options('assemblyai', { jobId: 'job' }), {
      ...transport(null), fetch: async () => json({ status: 'completed', text: 'Keep this result.', speech_model_used: reported }),
    });
    assert.deepEqual(result, { text: 'Keep this result.', model: expected });
  }
});

test('missing and malformed text is rejected, with nested Deepgram validation', async () => {
  for (const body of [null, [], {}, { text: 42 }, { text: null }, { text: 'a'.repeat(2_000_001) }]) {
    await rejectsCode(transcribe(options('openai'), transport(body)), 'invalid-response');
  }
  for (const body of [{}, { results: {} }, { results: { channels: [] } },
    { results: { channels: [{ alternatives: [] }] } }, { results: { channels: [{ alternatives: [{ transcript: null }] }] } }]) {
    await rejectsCode(transcribe(options('deepgram'), transport(body)), 'invalid-response');
  }
  assert.equal((await transcribe(options('groq'), transport({ text: '' }))).text, '');
  assert.throws(() => parseTranscriptionJson('synthetic-private-key'), { code: 'invalid-response' });
  assert.throws(() => parseTranscriptionJson(JSON.stringify({ text: '語'.repeat(2_666_667) })), { code: 'invalid-response' });
});

test('provider errors and uncertain POST failures never leak secrets or retry', async () => {
  for (const [status, code] of [[401, 'authentication'], [403, 'authentication'], [402, 'billing'], [429, 'rate-limit'],
    [413, 'file-too-large'], [415, 'unsupported-file'], [422, 'invalid-request'], [503, 'provider-unavailable'],
    [504, 'timeout'], [307, 'invalid-response']] as const) {
    let uploads = 0;
    await rejectsCode(transcribe(options('groq'), {
      fetch: unexpectedFetch, upload: async () => { uploads++; return { status, body: 'synthetic-private-key' }; },
    }), code);
    assert.equal(uploads, 1);
  }
  let posts = 0;
  await rejectsCode(transcribe(options('assemblyai'), {
    ...transport({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }),
    fetch: async () => { posts++; throw new Error('synthetic-private-key'); },
  }), 'network');
  assert.equal(posts, 1);
  let uploads = 0;
  await rejectsCode(transcribe(options('elevenlabs'), {
    fetch: unexpectedFetch, upload: async () => { uploads++; throw new Error('synthetic-private-key'); },
  }), 'network');
  assert.equal(uploads, 1);
});

test('abort before upload or while waiting for an AssemblyAI poll makes no further request', async () => {
  const controller = new AbortController();
  controller.abort();
  await rejectsCode(transcribe(options('openai', { signal: controller.signal }), {
    fetch: unexpectedFetch, upload: async () => { assert.fail('Aborted upload must not start'); },
  }), 'cancelled');
  const pending = new AbortController();
  let polls = 0;
  const promise = transcribe(options('assemblyai', { signal: pending.signal, jobId: 'job' }), {
    ...transport(null), fetch: async () => {
      polls++;
      setTimeout(() => pending.abort(), 5);
      return json({ status: 'processing' });
    },
  });
  await rejectsCode(promise, 'cancelled');
  assert.equal(polls, 1);
});

test('HTTP helper rejects redirects, untrusted destinations and oversized responses', async () => {
  for (const url of ['http://api.assemblyai.com/v2/transcript/job', 'https://attacker.test/v2/transcript/job',
    'https://api.assemblyai.com/v2/transcript/job#fragment', 'https://secret@api.assemblyai.com/v2/transcript/job',
    'https://api.assemblyai.com/v2/private']) {
    assert.throws(() => assertTrustedTranscriptionUrl(url), { code: 'invalid-request' });
  }
  const url = 'https://api.assemblyai.com/v2/transcript/job';
  const signal = new AbortController().signal;
  await rejectsCode(transcriptionJsonRequest(url, { method: 'GET' }, signal, async () =>
    new Response('{}', { headers: { 'content-length': '8000001' } })), 'invalid-response');
  await rejectsCode(transcriptionJsonRequest(url, { method: 'GET' }, signal, async () => {
    const response = json({ text: 'Hi' });
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  }), 'invalid-response');
  let cancelled = false;
  await rejectsCode(transcriptionJsonRequest(url, { method: 'GET' }, signal, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8_000_001)); },
    cancel() { cancelled = true; },
  }))), 'invalid-response');
  assert.equal(cancelled, true);
});

test('only an AssemblyAI job GET 404 is a terminal missing-job error', async () => {
  const signal = new AbortController().signal;
  const missing: typeof fetch = async () => json({ error: 'synthetic-private-key' }, 404);
  await rejectsCode(transcribe(options('assemblyai', { jobId: 'expired-job' }), {
    ...transport(null), fetch: missing,
  }), 'job-not-found');
  for (const [url, method] of [
    ['https://api.assemblyai.com/v2/transcript', 'POST'],
    ['https://api.assemblyai.com/v2/transcript/expired-job', 'POST'],
    ['https://api.openai.com/v1/audio/transcriptions', 'GET'],
  ]) {
    await rejectsCode(transcriptionJsonRequest(url, { method }, signal, missing), 'invalid-response');
  }
});

test('API keys are validated before calling a provider', async () => {
  for (const key of ['', 'has space', 'has\nnewline', '語', 'a'.repeat(4097)]) {
    await rejectsCode(transcribe(options('openai', { key }), {
      fetch: unexpectedFetch, upload: async (_request: TranscriptionUploadRequest) => { assert.fail('Invalid key'); },
    }), 'invalid-key');
  }
});
