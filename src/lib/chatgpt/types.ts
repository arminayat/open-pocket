export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', DIRECT_SCOPE];

export interface ChatGPTTokens {
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string;
  scopes: string[];
  expiresAt: number;
}
export interface ChatGPTProfile {
  clientId: string;
  subject: string | null;
  email: string | null;
  tokens: ChatGPTTokens | null;
}
export interface ChatGPTStore {
  hostId: string;
  profiles: ChatGPTProfile[];
  activeClientId: string | null;
}
export interface ChatGPTIdentity { subject: string; email: string | null }
export interface ChatGPTProfileView {
  clientId: string;
  label: string;
  active: boolean;
  signedIn: boolean;
  planEnabled: boolean;
  needsReconnect: boolean;
}

export class ChatGPTError extends Error {}
export class ChatGPTCancelled extends ChatGPTError {}
export class ChatGPTHttpError extends ChatGPTError {
  constructor(readonly status: number, readonly code: string | null) {
    super(status === 429 ? 'ChatGPT is receiving too many requests. Try again later.'
      : 'ChatGPT could not complete the account request. Please try again.');
  }
}
export const unusableRefresh = (error: unknown) => error instanceof ChatGPTHttpError && [
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused',
].includes(error.code ?? '');
