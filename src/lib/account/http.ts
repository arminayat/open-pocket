import { diagnostics } from '../diagnostics';
import { MCP_URL, objectValue, parseAccountInfo, parseRpcResponse, type PocketAccountInfo } from './helpers';

const NETWORK_TIMEOUT_MS = 20_000;
const PROTOCOL_VERSION = '2025-03-26';
const MAX_RESPONSE_BYTES = 256_000;
export type AccountFetcher = typeof fetch;

export class PocketHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 401
      ? 'Pocket authorization was rejected or expired. Sign in again, or check your API key.'
      : `Pocket could not complete the request (HTTP ${status}). Please try again.`);
    this.name = 'PocketHttpError';
  }
}

/** Keep the timeout active until the body has been read, not just until headers arrive. */
async function withRequest<T>(url: string, init: RequestInit,
  read: (response: Response) => Promise<T>, fetcher: AccountFetcher): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new PocketHttpError(response.status);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Pocket account request timed out. Check your internet connection and try again.');
    if (error instanceof PocketHttpError) throw error;
    // Avoid propagating URL, callback, token, response-body, or browser error strings.
    throw new Error('Pocket returned an incomplete account response, or the connection failed. Please try again.');
  } finally { clearTimeout(timeout); }
}

export async function requestJson(url: string, init: RequestInit = {},
  fetcher: AccountFetcher = fetch): Promise<unknown> {
  return withRequest(url, init, async response => {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('Account response too large.');
    return JSON.parse(text) as unknown;
  }, fetcher);
}

async function readRpcResponse(response: Response, requestId: number): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') && response.body?.getReader && typeof TextDecoder !== 'undefined') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        text += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        if (text.length > MAX_RESPONSE_BYTES) throw new Error('Account response too large.');
        const result = parseRpcResponse(text, contentType, requestId);
        if (result !== undefined) return result;
        if (chunk.done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else {
    const result = parseRpcResponse(await response.text(), contentType, requestId);
    if (result !== undefined) return result;
  }
  throw new Error('Pocket did not finish the account request.');
}

/** Short-lived MCP session. It calls only get_account_info, never recording/search tools. */
export async function readPocketAccount(credential: string,
  fetcher: AccountFetcher = fetch): Promise<PocketAccountInfo> {
  let sessionId = '';
  let protocolVersion = PROTOCOL_VERSION;
  let nextId = 1;
  let forgetSession = () => {};
  const headers = () => ({
    Authorization: `Bearer ${credential}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  });
  async function rpc(method: string, params: Record<string, unknown>, notification = false) {
    const id = nextId++;
    return withRequest(MCP_URL, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    }, async response => {
      const suppliedSession = response.headers.get('mcp-session-id');
      if (suppliedSession && suppliedSession !== sessionId) {
        forgetSession(); sessionId = suppliedSession;
        forgetSession = diagnostics.registerSecret(suppliedSession);
      }
      if (notification) return undefined;
      return readRpcResponse(response, id);
    }, fetcher);
  }
  async function initialize() {
    const result = objectValue(await rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION, capabilities: {},
      clientInfo: { name: 'OpenPocket', version: '0.1.0' },
    }));
    if (!result || typeof result.protocolVersion !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(result.protocolVersion)) {
      throw new Error('Pocket returned an unsupported account session. Try an API key or device key.');
    }
    protocolVersion = result.protocolVersion;
    await rpc('notifications/initialized', {}, true);
  }
  try {
    await initialize();
    let tool: unknown;
    try { tool = await rpc('tools/call', { name: 'get_account_info', arguments: {} }); }
    catch (error) {
      // MCP session ids can expire independently of authorization. Retry once with a new session.
      // Unauthorized credentials are never retried repeatedly or refreshed.
      if (!(error instanceof PocketHttpError) || error.status !== 404 || !sessionId) throw error;
      forgetSession(); forgetSession = () => {}; sessionId = ''; protocolVersion = PROTOCOL_VERSION;
      await initialize();
      tool = await rpc('tools/call', { name: 'get_account_info', arguments: {} });
    }
    return parseAccountInfo(tool);
  } finally { forgetSession(); sessionId = ''; }
}
