const MAX_RESPONSE_BYTES = 8_000_000;
const REQUEST_TIMEOUT_MS = 60_000;

const ERROR_MESSAGES = {
  'invalid-provider': 'Choose a supported transcription provider.',
  'invalid-key': 'Enter a valid API key without spaces or line breaks.',
  authentication: 'The provider rejected this API key. Check its permissions and update it in Settings.',
  billing: 'The provider requires API credits or billing. Check your provider account.',
  'rate-limit': 'The provider rate limit was reached. Wait before trying again.',
  'file-too-large': 'This recording exceeds the upload limit for the selected provider. Choose another provider.',
  'file-too-long': 'This provider supports recordings up to 10 hours. Choose another provider.',
  'unsupported-file': 'The recording is empty or is not a supported audio file.',
  'invalid-request': 'The provider could not accept this recording or transcription model.',
  'invalid-response': 'The provider returned an incomplete or unsupported transcription response.',
  'provider-unavailable': 'The transcription provider is unavailable. Check its status before trying again.',
  'native-unavailable': 'Rebuild and reinstall Open Pocket to enable transcription uploads on this iPhone.',
  network: 'The connection to the transcription provider failed. The provider may still process and charge for the request.',
  timeout: 'Transcription took too long to finish here. The provider may still be processing the recording.',
  cancelled: 'Transcription stopped in the app. The provider may still process and charge for the request.',
  'persist-job': 'The transcription job could not be saved on this device. The provider may still be processing it.',
  'job-failed': 'The provider could not transcribe this recording. Check the job in your provider account.',
  'job-not-found': 'This saved transcription job is no longer available from AssemblyAI. You can start a new transcription; a new charge may apply.',
} as const;

export type TranscriptionErrorCode = keyof typeof ERROR_MESSAGES;

/** Fixed messages only: never attach response bodies, credentials, or underlying errors. */
export class TranscriptionError extends Error {
  constructor(readonly code: TranscriptionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'TranscriptionError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TranscriptionError('cancelled');
}

export function assertTrustedTranscriptionUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new TranscriptionError('invalid-request'); }
  const trusted = url.origin === 'https://api.openai.com' && ['/v1/audio/transcriptions', '/v1/models'].includes(url.pathname)
    || url.origin === 'https://api.deepgram.com' && ['/v1/listen', '/v1/models'].includes(url.pathname)
    || url.origin === 'https://api.groq.com' && ['/openai/v1/audio/transcriptions', '/openai/v1/models'].includes(url.pathname)
    || url.origin === 'https://api.elevenlabs.io' && ['/v1/speech-to-text', '/v1/models'].includes(url.pathname)
    || url.origin === 'https://api.assemblyai.com' && (
      url.pathname === '/v2/upload' || url.pathname === '/v2/transcript'
      || /^\/v2\/transcript\/[A-Za-z0-9_-]{1,160}$/.test(url.pathname)
    );
  if (!trusted || url.username || url.password || url.hash) throw new TranscriptionError('invalid-request');
}

export function checkTranscriptionStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  const code: TranscriptionErrorCode = status === 401 || status === 403 ? 'authentication'
    : status === 402 ? 'billing' : status === 429 ? 'rate-limit'
    : status === 413 ? 'file-too-large' : status === 415 ? 'unsupported-file'
    : status === 400 || status === 422 ? 'invalid-request'
    : status === 408 || status === 504 ? 'timeout'
    : status >= 500 ? 'provider-unavailable' : 'invalid-response';
  throw new TranscriptionError(code);
}

export function parseTranscriptionJson(body: string): unknown {
  if (body.length > MAX_RESPONSE_BYTES) throw new TranscriptionError('invalid-response');
  // Count UTF-8 bytes without relying on TextEncoder availability in React Native.
  let bytes = 0;
  for (const character of body) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > MAX_RESPONSE_BYTES) throw new TranscriptionError('invalid-response');
  }
  try { return JSON.parse(body) as unknown; }
  catch { throw new TranscriptionError('invalid-response'); }
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_RESPONSE_BYTES) throw new TranscriptionError('invalid-response');
  // React Native fetch may not expose a streaming body; the final parser still enforces the byte limit.
  if (!response.body?.getReader || typeof TextDecoder === 'undefined') return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      bytes += chunk.value?.byteLength ?? 0;
      if (bytes > MAX_RESPONSE_BYTES) throw new TranscriptionError('invalid-response');
      body += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) return body;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Each HTTP request is made once; aborts and ambiguous POST results are never retried.
 * A billable submission can finish its bounded receipt and persistence even after a local cancel.
 */
export async function transcriptionJsonRequest(url: string, init: RequestInit, signal: AbortSignal,
  fetcher: typeof fetch, onReceipt?: (body: unknown) => Promise<void>): Promise<unknown> {
  assertTrustedTranscriptionUrl(url);
  throwIfAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  // Once a job submission is dispatched, keep its short receipt alive so a received ID is not lost.
  // This does not retry the POST or cancel the remote job; the request still has a hard deadline.
  if (!onReceipt) signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (!onReceipt) throwIfAborted(signal);
    if (response.redirected) throw new TranscriptionError('invalid-response');
    if (response.status === 404 && (init.method ?? 'GET').toUpperCase() === 'GET'
      && /^https:\/\/api\.assemblyai\.com\/v2\/transcript\/[A-Za-z0-9_-]{1,160}$/.test(url)) {
      throw new TranscriptionError('job-not-found');
    }
    checkTranscriptionStatus(response.status);
    const body = parseTranscriptionJson(await readBoundedResponse(response, controller.signal));
    if (onReceipt) await onReceipt(body);
    throwIfAborted(signal);
    if (controller.signal.aborted) throw new TranscriptionError('timeout');
    return body;
  } catch (error) {
    if (signal.aborted) throw new TranscriptionError('cancelled');
    if (controller.signal.aborted) throw new TranscriptionError('timeout');
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('network');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}
