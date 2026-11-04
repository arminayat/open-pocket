const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 180_000;

const ERROR_MESSAGES = {
  'invalid-key': 'Enter a valid API key without spaces or line breaks.',
  authentication: 'The provider rejected this API key. Check it and update it in Settings → AI.',
  billing: 'The provider needs credits or billing. Check your provider account.',
  'rate-limit': 'The provider rate limit was reached. Wait before trying again.',
  'no-key': 'Add an API key for this provider in Settings → AI first.',
  'not-signed-in': 'Sign in with ChatGPT and allow plan access in Settings → AI first.',
  'plan-limit': 'Your ChatGPT plan’s usage limit for other apps was reached. Try later or use an API key provider.',
  'plan-unavailable': 'ChatGPT plan usage is temporarily unavailable. Try again later or use an API key provider.',
  'plan-not-eligible': 'This ChatGPT account cannot use its plan in other apps. Use an API key provider instead.',
  'workspace-key': 'Claude needs a key that belongs to a workspace. Create one in the Claude Console and save it here.',
  'private-routing': 'No provider for this OpenRouter model offers zero data retention. Choose another model.',
  'too-long': 'This transcript is too long to summarize in one request.',
  'invalid-request': 'The provider rejected this request. The reason is in the Debug tab; if it continues, try another model.',
  'invalid-response': 'The provider returned an incomplete or unsupported response.',
  'provider-unavailable': 'The AI provider is unavailable. Check its status before trying again.',
  network: 'The connection to the AI provider failed. Check your connection and try again.',
  timeout: 'The AI provider took too long to answer. Try again.',
  cancelled: 'Stopped in the app. The provider may still count the request.',
} as const;

export type AiErrorCode = keyof typeof ERROR_MESSAGES;

/** Fixed messages only: never attach response bodies, credentials, or transcript text. */
export class AiError extends Error {
  /** The provider's own short reason, for the Debug log only; never shown in the UI. */
  constructor(readonly code: AiErrorCode, readonly detail?: string) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AiError';
  }
}

export function throwIfAiAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AiError('cancelled');
}

const TRUSTED: Record<string, string[]> = {
  'https://api.openai.com': ['/v1/responses', '/v1/models'],
  'https://api.anthropic.com': ['/v1/models', '/v1/messages'],
  'https://openrouter.ai': ['/api/v1/models', '/api/v1/chat/completions', '/api/v1/auth/keys'],
};

export function assertTrustedAiUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new AiError('invalid-request'); }
  if (!TRUSTED[url.origin]?.includes(url.pathname) || url.username || url.password || url.hash) throw new AiError('invalid-request');
}

/** The provider's error code, type, parameter and message, bounded; matched for specific messages and logged. */
function errorCode(body: string): string {
  try {
    const value = JSON.parse(body) as { error?: Record<string, unknown> };
    const error = value.error && typeof value.error === 'object' ? value.error : {};
    const parts = [error.code, error.type, error.param, error.message].filter(part => typeof part === 'string' || typeof part === 'number');
    if (parts.length) return parts.join(' ').slice(0, 400);
    // Other shapes (`detail`, `message`, plain text): keep a short excerpt for the Debug log.
    return JSON.stringify(value).slice(0, 300);
  } catch { return body.replace(/\s+/g, ' ').trim().slice(0, 300); }
}

export function statusError(status: number, body: string): AiError {
  const detail = errorCode(body);
  const error = statusCode(status, detail);
  return new AiError(error, `HTTP ${status}${detail ? ` ${detail}` : ''}`);
}

function statusCode(status: number, detail: string): AiErrorCode {
  if (detail.includes('subscription_sharing_usage_limit_exceeded')) return 'plan-limit';
  if (detail.includes('subscription_sharing_usage_unavailable')) return 'plan-unavailable';
  if (detail.includes('subscription_sharing_user_not_eligible')) return 'plan-not-eligible';
  if (status === 400 && detail.includes('anthropic-workspace-id')) return 'workspace-key';
  if (status === 404 && /data policy|zdr|data retention/i.test(detail)) return 'private-routing';
  if (/context|too long|maximum.*tokens/i.test(detail) && (status === 400 || status === 413)) return 'too-long';
  return status === 401 || status === 403 ? 'authentication'
    : status === 402 ? 'billing' : status === 429 ? 'rate-limit'
    : status === 400 || status === 404 || status === 422 ? 'invalid-request'
    : status === 408 || status === 504 ? 'timeout'
    : status >= 500 ? 'provider-unavailable' : 'invalid-response';
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new AiError('invalid-response');
  if (!response.body?.getReader || typeof TextDecoder === 'undefined') {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new AiError('invalid-response');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      throwIfAiAborted(signal);
      const chunk = await reader.read();
      bytes += chunk.value?.byteLength ?? 0;
      if (bytes > MAX_RESPONSE_BYTES) throw new AiError('invalid-response');
      body += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) return body;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * One request to a trusted provider URL; never retried. Returns the raw bounded body so callers
 * can parse JSON or a server-sent event stream. Redirects are refused.
 */
export async function aiRequest(url: string, init: RequestInit, signal: AbortSignal, fetcher: typeof fetch): Promise<string> {
  assertTrustedAiUrl(url);
  throwIfAiAborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (response.redirected) throw new AiError('invalid-response');
    const body = await readBounded(response, controller.signal);
    if (response.status < 200 || response.status >= 300) throw statusError(response.status, body);
    return body;
  } catch (error) {
    if (signal.aborted) throw new AiError('cancelled');
    if (controller.signal.aborted) throw new AiError('timeout');
    if (error instanceof AiError) throw error;
    throw new AiError('network');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

export function parseAiJson(body: string): unknown {
  try { return JSON.parse(body) as unknown; } catch { throw new AiError('invalid-response'); }
}
