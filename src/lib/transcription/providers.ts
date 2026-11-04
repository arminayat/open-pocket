import type { ProviderId, TranscriptionProvider } from './types';
import { TranscriptionError } from './request';

/** Larger provider limits are deliberately capped at 500 MB in this app. */
export const TRANSCRIPTION_PROVIDERS: readonly TranscriptionProvider[] = [
  {
    id: 'openai', name: 'OpenAI', model: 'gpt-transcribe', maxBytes: 25_000_000,
    apiKeyUrl: 'https://platform.openai.com/api-keys', pricingUrl: 'https://openai.com/api/pricing/',
    privacyUrl: 'https://platform.openai.com/docs/guides/your-data',
    description: 'General transcription with automatic language detection. Separate API billing from ChatGPT.',
  },
  {
    id: 'deepgram', name: 'Deepgram', model: 'nova-3', maxBytes: 500_000_000,
    apiKeyUrl: 'https://console.deepgram.com/', pricingUrl: 'https://deepgram.com/pricing',
    privacyUrl: 'https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program',
    description: 'Speech-focused transcription for long recordings. Requests opt out of model improvement.',
  },
  {
    id: 'assemblyai', name: 'AssemblyAI', model: 'universal-3-5-pro', maxBytes: 500_000_000,
    maxDurationSeconds: 36_000,
    apiKeyUrl: 'https://www.assemblyai.com/dashboard/', pricingUrl: 'https://www.assemblyai.com/pricing',
    privacyUrl: 'https://www.assemblyai.com/docs/data-retention-and-model-training',
    description: 'Transcription jobs that can be resumed after closing the app. Broad language coverage.',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', model: 'scribe_v2', maxBytes: 500_000_000,
    maxDurationSeconds: 36_000,
    apiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys', pricingUrl: 'https://elevenlabs.io/pricing/api',
    privacyUrl: 'https://elevenlabs.io/privacy-policy',
    description: 'Multilingual Scribe transcription for long recordings.',
  },
  {
    id: 'groq', name: 'Groq', model: 'whisper-large-v3-turbo', maxBytes: 25_000_000,
    apiKeyUrl: 'https://console.groq.com/keys', pricingUrl: 'https://console.groq.com/docs/speech-to-text',
    privacyUrl: 'https://console.groq.com/docs/your-data',
    description: 'Fast Whisper transcription with low usage-based pricing.',
  },
];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && TRANSCRIPTION_PROVIDERS.some(provider => provider.id === value);
}

export function getTranscriptionProvider(id: ProviderId): TranscriptionProvider {
  const provider = TRANSCRIPTION_PROVIDERS.find(item => item.id === id);
  if (!provider) throw new TranscriptionError('invalid-provider');
  return provider;
}

export function validateTranscriptionFile(id: ProviderId, bytes: number, durationSeconds?: number): void {
  const provider = getTranscriptionProvider(id);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new TranscriptionError('unsupported-file');
  if (bytes > provider.maxBytes) throw new TranscriptionError('file-too-large');
  if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
    throw new TranscriptionError('unsupported-file');
  }
  if (provider.maxDurationSeconds && durationSeconds !== undefined && durationSeconds > provider.maxDurationSeconds) {
    throw new TranscriptionError('file-too-long');
  }
}
