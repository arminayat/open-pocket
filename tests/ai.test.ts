import assert from 'node:assert/strict';
import test from 'node:test';
import { unsummarized } from '../src/lib/ai/auto';
import { createAiController } from '../src/lib/ai/controller';
import { discoverAiModels, MAX_TRANSCRIPT_CHARACTERS, parseResponsesStream, parseSummaryOutput, summarizeTranscript } from '../src/lib/ai/generate';
import { AiError, assertTrustedAiUrl, statusError } from '../src/lib/ai/request';
import { parseAiSettings, parseSummaries, type AiSettings, type SummaryEntry } from '../src/lib/ai/state';
import type { LocalRecording } from '../src/lib/pocket/types';
import { recordingKey, type TranscriptEntry } from '../src/lib/transcription/state';

const key = 'synthetic-private-key';
const signal = () => new AbortController().signal;
const OUTPUT = 'Title: Weekly planning call\n\nThe team planned the week.\n- Ship the beta\nAction items:\n- Anna writes notes';

/** Records each request and answers with the given body text. */
function fetcher(body: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const responses = (text: string) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const sse = (...events: unknown[]) => events.map(event => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('');

test('the summary format is parsed leniently and rejected when the title is missing', () => {
  assert.deepEqual(parseSummaryOutput(OUTPUT), { title: 'Weekly planning call',
    summary: 'The team planned the week.\n- Ship the beta\nAction items:\n- Anna writes notes' });
  assert.equal(parseSummaryOutput('**Title:** "Budget review"\n\n**Gist** here.').title, 'Budget review');
  assert.equal(parseSummaryOutput('**Title:** "Budget review"\n\n**Gist** here.').summary, 'Gist here.');
  assert.throws(() => parseSummaryOutput('Just a summary.'), { code: 'invalid-response' });
  assert.throws(() => parseSummaryOutput('Title: Only a title'), { code: 'invalid-response' });
});

test('each provider gets its own request shape; OpenRouter always asks for zero data retention', async () => {
  const openai = fetcher(responses(OUTPUT));
  assert.equal((await summarizeTranscript({ provider: 'openai', secret: key }, 'gpt-6-luna', 'Hello.', openai.fetch, signal())).title, 'Weekly planning call');
  assert.equal(openai.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(openai.calls[0].headers.Authorization, `Bearer ${key}`);
  assert.deepEqual([openai.calls[0].body?.store, openai.calls[0].body?.stream, openai.calls[0].body?.max_output_tokens], [false, undefined, 3000]);

  const chatgpt = fetcher(sse({ type: 'response.output_text.delta', delta: 'x' }, { type: 'response.completed', response: responses(OUTPUT) }));
  const plan = await summarizeTranscript({ provider: 'chatgpt', secret: 'plan-token' }, 'gpt-6.1-sol', 'Hello.', chatgpt.fetch, signal());
  assert.equal(plan.model, 'gpt-6.1-sol');
  assert.deepEqual([chatgpt.calls[0].body?.stream, chatgpt.calls[0].body?.store, 'max_output_tokens' in (chatgpt.calls[0].body ?? {})], [true, false, false]);
  assert.deepEqual(chatgpt.calls[0].body?.input, [{ role: 'user', content: [{ type: 'input_text', text: 'Transcript:\nHello.' }] }]);

  const claude = fetcher({ content: [{ type: 'text', text: OUTPUT }] });
  await summarizeTranscript({ provider: 'anthropic', secret: key }, 'claude-haiku-5-5', 'Hello.', claude.fetch, signal());
  assert.deepEqual([claude.calls[0].url, claude.calls[0].headers['x-api-key'], claude.calls[0].headers['anthropic-version']],
    ['https://api.anthropic.com/v1/messages', key, '2023-06-01']);
  assert.equal(typeof claude.calls[0].body?.system, 'string');

  const router = fetcher({ choices: [{ message: { content: OUTPUT } }] });
  await summarizeTranscript({ provider: 'openrouter', secret: key }, 'openai/gpt-oss-120b', 'Hello.', router.fetch, signal());
  assert.equal(router.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.deepEqual(router.calls[0].body?.provider, { zdr: true, data_collection: 'deny' });
});

test('plan streams only count once completed; plan, workspace and privacy errors get specific messages', async () => {
  assert.throws(() => parseResponsesStream(sse({ type: 'response.output_text.delta', delta: 'Title: x' })), { code: 'invalid-response' });
  // Some streams only carry the text in deltas; the completed event's output is empty.
  assert.equal(parseResponsesStream(sse({ type: 'response.output_text.delta', delta: 'Title: A\n\n' },
    { type: 'response.output_text.delta', delta: 'Gist.' }, { type: 'response.completed', response: { status: 'completed', output: [] } })), 'Title: A\n\nGist.');
  assert.throws(() => parseResponsesStream(sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })), { code: 'plan-limit' });
  assert.equal(statusError(429, JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } })).code, 'plan-limit');
  assert.equal(statusError(403, JSON.stringify({ error: { code: 'subscription_sharing_user_not_eligible' } })).code, 'plan-not-eligible');
  assert.equal(statusError(400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'anthropic-workspace-id header is required' } })).code, 'workspace-key');
  assert.equal(statusError(404, JSON.stringify({ error: { code: 404, message: 'No endpoints found matching your data policy' } })).code, 'private-routing');
  assert.equal(statusError(401, 'not json').code, 'authentication');
  await assert.rejects(summarizeTranscript({ provider: 'openai', secret: key }, 'gpt-6-luna', 'x', fetcher({ error: { message: key } }, 401).fetch, signal()),
    (error: unknown) => error instanceof AiError && error.code === 'authentication' && !error.message.includes(key));
  await assert.rejects(summarizeTranscript({ provider: 'openai', secret: key }, 'gpt-6-luna', 'x'.repeat(MAX_TRANSCRIPT_CHARACTERS + 1), fetcher({}).fetch, signal()), { code: 'too-long' });
  await assert.rejects(summarizeTranscript({ provider: 'openai', secret: key }, 'bad model', 'x', fetcher({}).fetch, signal()), { code: 'invalid-request' });
  for (const url of ['https://api.openai.com/v1/files', 'https://evil.example/v1/responses', 'https://user@api.openai.com/v1/responses']) {
    assert.throws(() => assertTrustedAiUrl(url), { code: 'invalid-request' });
  }
});

test('model lists keep text models the credential can use', async () => {
  const openai = fetcher({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-transcribe' }, { id: 'gpt-realtime' }, { id: 'gpt-6-luna' }, { id: 'tts-1' }] });
  assert.deepEqual((await discoverAiModels({ provider: 'openai', secret: key }, openai.fetch, signal())).map(model => model.id), ['gpt-6-luna', 'gpt-6.1-sol']);
  const plan = fetcher({ models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] });
  assert.deepEqual((await discoverAiModels({ provider: 'chatgpt', secret: 'plan' }, plan.fetch, signal())).map(model => model.id), ['gpt-6.1-sol']);
  const claude = fetcher({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-fable-5-1' }, { id: 'claude-haiku-5-5' }] });
  assert.deepEqual((await discoverAiModels({ provider: 'anthropic', secret: key }, claude.fetch, signal())).map(model => model.id), ['claude-haiku-5-5', 'claude-opus-5-5']);
  const router = fetcher({ data: [
    { id: 'meta/small', name: 'Small', context_length: 8000, pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/model:free', name: 'Vendor free', context_length: 128000, pricing: { prompt: '0', completion: '0' } },
    { id: 'openai/gpt-oss-120b', name: 'OpenAI: gpt-oss-120b', context_length: 131072, pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  ] });
  const routed = await discoverAiModels({ provider: 'openrouter', secret: key }, router.fetch, signal());
  assert.deepEqual(routed.map(model => [model.id, model.note]), [
    ['openai/gpt-oss-120b', '$0.15 / $0.60 per million tokens'], ['vendor/model:free', 'Free (may have daily limits)']]);
});

const recording = (timestamp: string): LocalRecording => ({ id: `2026-10-29/${timestamp}`, date: '2026-10-29', timestamp, durationSeconds: 8,
  uri: `file:///Documents/recordings/${timestamp}.mp3`, bytes: 1000, transport: 'bluetooth', downloadedAt: '2026-10-29T13:50:00.000Z' });
const transcript = (item: LocalRecording, text = 'Hello there.'): TranscriptEntry => ({ recordingKey: recordingKey(item), provider: 'groq',
  status: 'complete', text, model: 'whisper-large-v3', updatedAt: '2026-10-29T13:50:00.000Z' });

function harness(initial: AiSettings, answer: () => Promise<{ title: string; summary: string; model: string }>) {
  let stored = structuredClone(initial);
  let saved: Record<string, SummaryEntry> = {};
  const credentials: string[] = [];
  const client = createAiController({
    loadSettings: async () => structuredClone(stored), saveSettings: async value => { stored = structuredClone(value); },
    loadEntries: async () => ({}), saveEntries: async value => { saved = structuredClone(value); },
    planToken: async () => 'plan-token', authorizeOpenRouter: async () => 'sk-or-issued',
    summarize: async credential => { credentials.push(credential.secret); return answer(); },
    listModels: async () => [], registerSecret: () => () => {},
  });
  return { client, stored: () => stored, saved: () => saved, credentials };
}

test('the controller summarizes with the saved credential, keeps secrets out of its snapshot, and records failures', async () => {
  const item = recording('20261029100000');
  let fail = false;
  const { client, stored, saved, credentials } = harness({ selectedProvider: 'anthropic', keys: {}, models: {} },
    async () => { if (fail) throw new AiError('rate-limit'); return { title: 'Plan', summary: 'Gist.', model: 'claude-haiku-5-5' }; });
  await client.load();
  assert.equal(await client.generate(item, 'Hello.'), false);
  assert.equal(client.snapshot().failures[recordingKey(item)], new AiError('no-key').message);
  assert.equal(await client.saveKey('anthropic', key), true);
  assert.equal(await client.generate(item, 'Hello.'), true);
  assert.equal(saved()[recordingKey(item)].title, 'Plan');
  assert.deepEqual(credentials, [key]);
  assert.equal(JSON.stringify(client.snapshot()).includes(key), false);
  fail = true;
  assert.equal(await client.generate(item, 'Hello.'), false);
  assert.equal(client.snapshot().entries[recordingKey(item)].title, 'Plan');
  assert.equal(stored().keys.anthropic, key);
  assert.equal(await client.connectOpenRouter(), true);
  assert.deepEqual([stored().selectedProvider, stored().keys.openrouter], ['openrouter', 'sk-or-issued']);
});

test('automatic summaries need consent for the provider, go newest first, and pause after a failure', async () => {
  const older = recording('20261029100000');
  const newer = recording('20261029110000');
  const untranscribed = recording('20261029120000');
  const transcripts = { [recordingKey(older)]: transcript(older), [recordingKey(newer)]: transcript(newer) };
  let fail = false;
  const { client, credentials } = harness({ selectedProvider: 'chatgpt', keys: {}, models: {} },
    async () => { if (fail) throw new AiError('plan-limit'); return { title: 'T', summary: 'S.', model: 'gpt-6.1-sol' }; });
  await client.load();
  const candidates = () => unsummarized([older, newer, untranscribed], transcripts, client.snapshot().entries);
  assert.deepEqual(candidates().map(item => item.recording.id), [newer.id, older.id]);
  await client.autoSummarize(candidates());
  assert.equal(credentials.length, 0);
  await client.setAutoSummarize(true);
  fail = true;
  await client.autoSummarize(candidates());
  assert.equal(client.snapshot().autoPaused, true);
  await client.autoSummarize(candidates());
  assert.equal(credentials.length, 1);
  fail = false;
  client.resumeAuto();
  await client.autoSummarize(candidates());
  assert.deepEqual(candidates().map(item => item.recording.id), [newer.id]);
  await client.selectProvider('openai');
  assert.equal(client.snapshot().autoSummarize, false);
});

test('saved settings and summaries are validated', () => {
  assert.deepEqual(parseAiSettings(JSON.stringify({ selectedProvider: 'openrouter', keys: { openrouter: key }, models: { openrouter: 'vendor/model:free' }, autoSummarize: 'openrouter' })),
    { selectedProvider: 'openrouter', keys: { openrouter: key }, models: { openrouter: 'vendor/model:free' }, autoSummarize: 'openrouter' });
  assert.throws(() => parseAiSettings(JSON.stringify({ selectedProvider: 'chatgpt', keys: { chatgpt: key }, models: {} })));
  assert.throws(() => parseAiSettings(JSON.stringify({ selectedProvider: 'gemini', keys: {}, models: {} })));
  const item = recording('20261029100000');
  const entry = { recordingKey: recordingKey(item), provider: 'openai', model: 'gpt-6-luna', title: 'T', summary: 'S', updatedAt: '2026-10-29T13:50:00.000Z' };
  assert.equal(parseSummaries([entry])[entry.recordingKey].title, 'T');
  assert.throws(() => parseSummaries([{ ...entry, title: '' }]));
  assert.throws(() => parseSummaries([{ ...entry, recordingKey: '["x","../a.mp3",1]' }]));
  assert.throws(() => parseSummaries([entry, entry]));
});

test('synced summaries replace only older local ones, and never a summary changed during the sync run', async () => {
  const item = recording('20261029100000');
  const { client, saved } = harness({ selectedProvider: 'openai', keys: {}, models: {} }, async () => ({ title: 'T', summary: 'S.', model: 'gpt-6-luna' }));
  await client.load();
  const base = { recordingKey: 'ignored', provider: 'openai' as const, model: 'gpt-6-luna', title: 'Old', summary: 'Old.', updatedAt: '2026-10-29T10:00:00.000Z' };
  await client.mergeSummary(item, base, null);
  assert.equal(saved()[recordingKey(item)].title, 'Old');
  await client.mergeSummary(item, { ...base, title: 'Older', updatedAt: '2026-10-28T10:00:00.000Z' });
  assert.equal(client.snapshot().entries[recordingKey(item)].title, 'Old');
  await assert.rejects(client.mergeSummary(item, { ...base, title: 'New', updatedAt: '2026-10-30T10:00:00.000Z' }, null), /changed during sync/);
  await client.mergeSummary(item, { ...base, title: 'New', updatedAt: '2026-10-30T10:00:00.000Z' }, client.snapshot().entries[recordingKey(item)]);
  assert.equal(client.snapshot().entries[recordingKey(item)].title, 'New');
  await assert.rejects(client.mergeSummary(item, { ...base, title: '' }), /invalid/);
  assert.deepEqual(unsummarized([{ ...item, transport: 'icloud' }], { [recordingKey(item)]: transcript(item) }, {}), []);
});

test('without a chosen model the first listed one is used when the recommended one is missing, and failures reach the log', async () => {
  const item = recording('20261029100000');
  const used: string[] = [];
  const logged: string[] = [];
  const client = createAiController({
    loadSettings: async () => ({ selectedProvider: 'chatgpt', keys: {}, models: {} }), saveSettings: async () => {},
    loadEntries: async () => ({}), saveEntries: async () => {}, planToken: async () => 'plan-token',
    authorizeOpenRouter: async () => 'unused', registerSecret: () => () => {},
    listModels: async () => [{ id: 'gpt-plan-a', label: 'Plan A' }, { id: 'gpt-plan-b', label: 'Plan B' }],
    summarize: async (_credential, model) => { used.push(model); throw statusError(400, JSON.stringify({ error: { type: 'invalid_request_error', param: 'model', message: 'Unknown model' } })); },
    onError: (context, cause) => logged.push(`${context}: ${(cause as AiError).detail}`),
  });
  await client.load();
  assert.equal(client.snapshot().selectedModels.chatgpt, 'gpt-6.1-sol');
  assert.equal(await client.generate(item, 'Hello.'), false);
  assert.equal(client.snapshot().selectedModels.chatgpt, 'gpt-plan-a');
  assert.deepEqual(used, ['gpt-plan-a']);
  assert.deepEqual(logged, [`Summarizing ${item.id} with ChatGPT (gpt-plan-a): HTTP 400 invalid_request_error model Unknown model`]);
});
