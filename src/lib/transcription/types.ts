export type ProviderId = 'openai' | 'deepgram' | 'assemblyai' | 'elevenlabs' | 'groq';

export interface TranscriptionProvider {
  id: ProviderId;
  name: string;
  /** Recommended speech model, used until the user chooses another. */
  model: string;
  maxBytes: number;
  maxDurationSeconds?: number;
  apiKeyUrl: string;
  pricingUrl: string;
  privacyUrl: string;
  description: string;
}

export interface TranscriptionUploadRequest {
  url: string;
  headers: Record<string, string>;
  /** Present for multipart requests; absent for a raw binary body. */
  parameters?: Record<string, string>;
  mimeType: string;
  uri: string;
  signal: AbortSignal;
}

export interface TranscriptionUploadResponse { status: number; body: string }

export interface TranscriptionTransport {
  upload: (request: TranscriptionUploadRequest) => Promise<TranscriptionUploadResponse>;
  fetch: typeof fetch;
}

export interface TranscribeOptions {
  provider: ProviderId;
  key: string;
  /** Speech model; defaults to the provider's recommended model. */
  model?: string;
  uri: string;
  signal: AbortSignal;
  jobId?: string;
  onJob: (jobId: string) => Promise<void>;
  onStage: (stage: string) => void;
}

export interface TranscriptionResult { text: string; model: string }
