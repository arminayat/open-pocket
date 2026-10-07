export const MCP_URL = 'https://public.heypocketai.com/mcp';
export const OAUTH_REDIRECT_URI = 'openpocket://oauth/callback';
export const DISCOVERY_URL = 'https://public.heypocketai.com/.well-known/oauth-authorization-server';

export interface PocketOAuthMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

export interface PocketAccountInfo {
  userId: string;
  accountLabel: string;
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function validateDeviceKey(input: string): string {
  const value = input.trim();
  if (!/^[\x21-\x7e]{16}$/.test(value) || value.includes('&')) {
    throw new Error('The Pocket device key must be 16 ASCII characters, with no spaces or &.');
  }
  return value;
}

/** Matches the vendor web bind-key algorithm. BLE compatibility still needs device verification. */
export function deriveCandidateKey(userId: string): string {
  if (!userId || !/^[\x21-\x7e]+$/.test(userId) || userId.length > 128) {
    throw new Error('Pocket returned an unsupported account identifier. Try importing a device key.');
  }
  return validateDeviceKey(userId.substring(0, 16).padEnd(16, '0'));
}

export function trustedPocketEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Pocket returned incomplete sign-in metadata.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Pocket returned an invalid sign-in endpoint.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !['production.heypocketai.com', 'public.heypocketai.com'].includes(url.hostname)) {
    throw new Error('Pocket returned an unsupported sign-in endpoint. Try an API key instead.');
  }
  return url.href;
}

export function parseOAuthMetadata(value: unknown): PocketOAuthMetadata {
  const metadata = objectValue(value);
  if (!metadata || !Array.isArray(metadata.code_challenge_methods_supported) ||
      !metadata.code_challenge_methods_supported.includes('S256') ||
      !Array.isArray(metadata.token_endpoint_auth_methods_supported) ||
      !metadata.token_endpoint_auth_methods_supported.includes('none')) {
    throw new Error('Pocket does not currently advertise public-client PKCE sign-in. Use an API key or device key.');
  }
  if (!metadata.registration_endpoint) {
    throw new Error('Pocket does not advertise app registration. Use an API key or device key.');
  }
  return {
    authorizationEndpoint: trustedPocketEndpoint(metadata.authorization_endpoint),
    tokenEndpoint: trustedPocketEndpoint(metadata.token_endpoint),
    registrationEndpoint: trustedPocketEndpoint(metadata.registration_endpoint),
  };
}

export function registrationBody() {
  return {
    client_name: 'OpenPocket',
    application_type: 'native',
    redirect_uris: [OAUTH_REDIRECT_URI],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'mcp:read',
  };
}

export function parseRegistration(value: unknown): string {
  const data = objectValue(value);
  if (!data || typeof data.client_id !== 'string' || !data.client_id ||
      data.client_id.length > 512 || data.client_secret ||
      (data.token_endpoint_auth_method && data.token_endpoint_auth_method !== 'none') ||
      (Array.isArray(data.redirect_uris) && !data.redirect_uris.includes(OAUTH_REDIRECT_URI))) {
    throw new Error('Pocket did not accept this app’s native callback. Use an API key or device key instead.');
  }
  return data.client_id;
}

export function validateAuthorizationResult(expectedState: string, params: Record<string, string>): string {
  if (!expectedState || params.state !== expectedState) {
    throw new Error('Pocket sign-in could not be verified. Please start sign-in again.');
  }
  if (!params.code || params.code.length > 4096) {
    throw new Error('Pocket did not return a sign-in code. Try again or use an API key.');
  }
  return params.code;
}

/** Parse only JSON-RPC responses for this request; notifications and other ids are ignored. */
export function parseRpcResponse(text: string, contentType: string, requestId: number): unknown | undefined {
  if (text.length > 256_000) throw new Error('Pocket returned an unexpectedly large account response.');
  const candidates: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
      const data = block.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data === '[DONE]') continue;
      try { candidates.push(JSON.parse(data)); } catch { /* A streaming chunk may be incomplete. */ }
    }
  } else {
    try { candidates.push(JSON.parse(text)); }
    catch { throw new Error('Pocket returned an unreadable account response.'); }
  }
  for (const candidate of candidates) {
    const message = objectValue(candidate);
    if (!message || message.jsonrpc !== '2.0' || message.id !== requestId) continue;
    if (message.error) throw new Error('Pocket could not complete this account request. Try signing in again.');
    if ('result' in message) return message.result;
  }
  return undefined;
}

export function parseAccountInfo(result: unknown): PocketAccountInfo {
  const tool = objectValue(result);
  if (!tool || tool.isError) throw new Error('Pocket could not read your account info. Try signing in again.');
  const candidates: unknown[] = [];
  if (tool.structuredContent) candidates.push(tool.structuredContent);
  if (Array.isArray(tool.content)) {
    for (const block of tool.content) {
      const content = objectValue(block);
      if (content?.type === 'text' && typeof content.text === 'string') {
        try { candidates.push(JSON.parse(content.text)); } catch { /* Only structured account info is accepted. */ }
      }
    }
  }
  for (const candidate of candidates) {
    const envelope = objectValue(candidate);
    if (!envelope || envelope.success === false) continue;
    const data = objectValue(envelope.data) ?? envelope;
    if (typeof data.userId !== 'string') continue;
    deriveCandidateKey(data.userId);
    const email = typeof data.email === 'string' && data.email.length <= 254 ? data.email : '';
    return { userId: data.userId, accountLabel: email || 'Pocket account' };
  }
  throw new Error('Pocket did not return your account ID. Try an API key or import a device key.');
}
