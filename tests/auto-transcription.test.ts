import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalRecording } from '../src/lib/pocket/types';
import { untranscribed } from '../src/lib/transcription/auto';
import { createTranscriptionController } from '../src/lib/transcription/controller';
import { TranscriptionError } from '../src/lib/transcription/request';
import { parseTranscriptionCredentials, recordingKey, type TranscriptionCredentials } from '../src/lib/transcription/state';
import type { TranscribeOptions } from '../src/lib/transcription/types';

const key = 'synthetic-private-key';
function recording(timestamp: string, extra: Partial<LocalRecording> = {}): LocalRecording {
  const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
  return { id: `${date}/${timestamp}`, date, timestamp, durationSeconds: 8, uri: `file:///Documents/recordings/${timestamp}.mp3`,
    bytes: 1000, transport: 'bluetooth', downloadedAt: '2026-10-29T13:50:00.000Z', ...extra };
}

test('candidates are the newest untranscribed recorder copies; iCloud imports are skipped', () => {
  const older = recording('20261028100000');
  const newer = recording('20261029100000');
  const newerCopy = { ...newer, uri: 'file:///Documents/recordings/copy.mp3', downloadedAt: '2026-10-30T00:00:00.000Z' };
  const imported = recording('20261030100000', { transport: 'icloud' });
  const done = recording('20261027100000');
  const entries = { [recordingKey(done)]: { recordingKey: recordingKey(done), provider: 'groq' as const, status: 'complete' as const,
    text: 'Hi.', model: 'whisper-large-v3', updatedAt: '2026-10-29T13:50:00.000Z' } };
  assert.deepEqual(untranscribed([older, done, newer, newerCopy, imported], entries), [newerCopy, older]);
});

function harness(initial: TranscriptionCredentials) {
  let stored = structuredClone(initial);
  const sent: TranscribeOptions[] = [];
  let fail = false;
  const client = createTranscriptionController({
    loadCredentials: async () => structuredClone(stored), saveCredentials: async value => { stored = structuredClone(value); },
    loadEntries: async () => ({}), saveEntries: async () => {}, registerSecret: () => () => {}, listModels: async () => [],
    checkRecording: item => { if (item.uri.includes('missing')) throw new Error('missing'); },
    transcribe: async options => {
      sent.push(options);
      if (fail) throw new TranscriptionError('provider-unavailable');
      return { text: 'Hi.', model: options.model! };
    },
  });
  return { client, sent, stored: () => stored, failNext: (value: boolean) => { fail = value; } };
}

test('automatic transcription needs consent for the selected provider and runs one recording at a time', async () => {
  const library = [recording('20261028100000'), recording('20261029100000')];
  const { client, sent, stored } = harness({ selectedProvider: 'groq', keys: { groq: key } });
  await client.load();
  await client.autoTranscribe(library);
  assert.equal(sent.length, 0);
  await client.setAutoTranscribe(true);
  assert.equal(stored().autoTranscribe, 'groq');
  assert.equal(client.snapshot().autoTranscribe, true);
  await client.autoTranscribe(library);
  await client.autoTranscribe(library);
  await client.autoTranscribe(library);
  assert.deepEqual(sent.map(item => item.uri), [library[1].uri, library[0].uri]);
  assert.equal(Object.values(client.snapshot().entries).every(entry => entry.status === 'complete'), true);
  // Consent does not carry over to another provider.
  await client.selectProvider('openai');
  assert.equal(client.snapshot().autoTranscribe, false);
  assert.equal(parseTranscriptionCredentials(JSON.stringify(stored())).autoTranscribe, 'groq');
});

test('a failed request pauses until resumed and is never retried; local pre-check failures only skip', async () => {
  const library = [recording('20261027100000'), recording('20261028100000'), recording('20261029100000', { uri: 'file:///missing.mp3' })];
  const { client, sent, failNext } = harness({ selectedProvider: 'groq', keys: { groq: key }, autoTranscribe: 'groq' });
  await client.load();
  await client.autoTranscribe(library);
  assert.equal(sent.length, 0);
  assert.equal(client.snapshot().autoPaused, false);
  failNext(true);
  await client.autoTranscribe(library);
  assert.deepEqual(sent.map(item => item.uri), [library[1].uri]);
  assert.equal(client.snapshot().autoPaused, true);
  failNext(false);
  await client.autoTranscribe(library);
  assert.equal(sent.length, 1);
  client.resumeAuto();
  await client.autoTranscribe(library);
  await client.autoTranscribe(library);
  assert.deepEqual(sent.map(item => item.uri), [library[1].uri, library[0].uri]);
  assert.equal(client.snapshot().autoPaused, false);
});
