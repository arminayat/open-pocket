import { ASSEMBLY_AUTO, resolveModel, validModelId } from './models';
import { getTranscriptionProvider } from './providers';
import {
  assertTrustedTranscriptionUrl, checkTranscriptionStatus, parseTranscriptionJson,
  throwIfAborted, TranscriptionError, transcriptionJsonRequest,
} from './request';
import type { TranscribeOptions, TranscriptionResult, TranscriptionTransport, TranscriptionUploadRequest } from './types';

const ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';
const SESSION_TIMEOUT_MS = 20 * 60_000;
const MAX_TEXT_LENGTH = 2_000_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TranscriptionError('invalid-response');
  return value as Record<string, unknown>;
}

function transcript(value: unknown, model: string): TranscriptionResult {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) throw new TranscriptionError('invalid-response');
  return { text: value, model };
}

function validJobId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new TranscriptionError('invalid-response');
  }
  return value;
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new TranscriptionError('cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 3_000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function upload(request: TranscriptionUploadRequest, transport: TranscriptionTransport): Promise<unknown> {
  assertTrustedTranscriptionUrl(request.url);
  throwIfAborted(request.signal);
  try {
    const response = await transport.upload(request);
    throwIfAborted(request.signal);
    checkTranscriptionStatus(response.status);
    return parseTranscriptionJson(response.body);
  } catch (error) {
    if (request.signal.aborted) throw new TranscriptionError('cancelled');
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('network');
  }
}

async function transcribeAssembly(options: TranscribeOptions, transport: TranscriptionTransport): Promise<TranscriptionResult> {
  const { key, signal, onStage } = options;
  const headers = { Authorization: key, Accept: 'application/json' };
  let jobId = options.jobId;
  if (jobId !== undefined) validJobId(jobId);
  if (jobId === undefined) {
    onStage('Uploading audio');
    const uploaded = record(await upload({
      url: `${ASSEMBLY_BASE}/upload`, headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      mimeType: 'audio/mpeg', uri: options.uri, signal,
    }, transport));
    let audioUrl: URL;
    try { audioUrl = new URL(String(uploaded.upload_url)); }
    catch { throw new TranscriptionError('invalid-response'); }
    if (audioUrl.origin !== 'https://cdn.assemblyai.com' || audioUrl.username || audioUrl.password
      || audioUrl.hash || !audioUrl.pathname.startsWith('/upload/')) throw new TranscriptionError('invalid-response');
    onStage('Starting transcription');
    await transcriptionJsonRequest(`${ASSEMBLY_BASE}/transcript`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl.href, language_detection: true,
        speech_models: options.model && options.model !== ASSEMBLY_AUTO ? [options.model] : ['universal-3-5-pro', 'universal-2'] }),
    }, signal, transport.fetch, async body => {
      jobId = validJobId(record(body).id);
      // Persist the accepted ID before honoring cancellation or polling the billable job.
      try { await options.onJob(jobId); }
      catch { throw new TranscriptionError('persist-job'); }
    });
  }
  validJobId(jobId);
  onStage('Transcribing audio');
  while (true) {
    const result = record(await transcriptionJsonRequest(`${ASSEMBLY_BASE}/transcript/${jobId}`, {
      method: 'GET', headers,
    }, signal, transport.fetch));
    if (result.id !== undefined && result.id !== jobId) throw new TranscriptionError('invalid-response');
    if (result.status === 'completed') {
      // This provenance field is optional; do not discard a paid result when it is absent.
      const reportedModel = result.speech_model_used;
      const model = typeof reportedModel === 'string' && reportedModel.trim() && reportedModel.length <= 100
        ? reportedModel : 'unknown';
      return transcript(result.text, model);
    }
    if (result.status === 'error') throw new TranscriptionError('job-failed');
    if (result.status !== 'queued' && result.status !== 'processing') throw new TranscriptionError('invalid-response');
    await waitForPoll(signal);
  }
}

/** Sends audio only to the explicitly selected provider using the user's API key. */
export async function transcribe(options: TranscribeOptions, transport: TranscriptionTransport): Promise<TranscriptionResult> {
  throwIfAborted(options.signal);
  const provider = getTranscriptionProvider(options.provider);
  if (!options.key || options.key.length > 4096 || !/^[\x21-\x7e]+$/.test(options.key)) {
    throw new TranscriptionError('invalid-key');
  }
  if (options.jobId !== undefined && options.provider !== 'assemblyai') throw new TranscriptionError('invalid-request');
  if (options.model !== undefined && !validModelId(options.model)) throw new TranscriptionError('invalid-request');
  const model = resolveModel(provider.id, options.model);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  const current = { ...options, model, signal: controller.signal };
  try {
    if (provider.id === 'assemblyai') return await transcribeAssembly(current, transport);
    options.onStage('Uploading audio');
    const request: TranscriptionUploadRequest = {
      url: '', uri: options.uri, signal: controller.signal, mimeType: 'audio/mpeg',
      headers: { Authorization: `Bearer ${options.key}`, Accept: 'application/json' },
    };
    if (provider.id === 'deepgram') {
      request.url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&detect_language=true&mip_opt_out=true`;
      request.headers = { Authorization: `Token ${options.key}`, 'Content-Type': 'audio/mpeg', Accept: 'application/json' };
    } else if (provider.id === 'elevenlabs') {
      request.url = 'https://api.elevenlabs.io/v1/speech-to-text';
      request.headers = { 'xi-api-key': options.key, Accept: 'application/json' };
      request.parameters = { model_id: model, tag_audio_events: 'false', timestamps_granularity: 'none' };
    } else {
      request.url = provider.id === 'openai' ? 'https://api.openai.com/v1/audio/transcriptions'
        : 'https://api.groq.com/openai/v1/audio/transcriptions';
      // gpt-transcribe's documented minimal request returns JSON without response_format.
      request.parameters = provider.id === 'openai' ? { model } : { model, response_format: 'json' };
    }
    const body = record(await upload(request, transport));
    if (provider.id !== 'deepgram') return transcript(body.text, model);
    const channels = record(body.results).channels;
    if (!Array.isArray(channels) || !channels.length) throw new TranscriptionError('invalid-response');
    const alternatives = record(channels[0]).alternatives;
    if (!Array.isArray(alternatives) || !alternatives.length) throw new TranscriptionError('invalid-response');
    return transcript(record(alternatives[0]).transcript, model);
  } catch (error) {
    if (options.signal.aborted) throw new TranscriptionError('cancelled');
    if (controller.signal.aborted) throw new TranscriptionError('timeout');
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('network');
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener('abort', onAbort);
  }
}
