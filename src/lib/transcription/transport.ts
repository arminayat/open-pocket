import { fetch as expoFetch } from 'expo/fetch';
import { requireTranscriptionNative } from '../../../modules/pocket-transcription';
import { throwIfAborted, TranscriptionError } from './request';
import type { TranscriptionTransport } from './types';

export const transcriptionTransport: TranscriptionTransport = {
  fetch: expoFetch as typeof fetch,
  async upload(request) {
    throwIfAborted(request.signal);
    let native;
    try { native = requireTranscriptionNative(); }
    catch { throw new TranscriptionError('native-unavailable'); }
    // Reserve synchronously so cancellation cannot race ahead of native registration.
    const id = native.reserve();
    const cancel = () => native.cancel(id);
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (request.signal.aborted) cancel();
      const result = await native.upload(id, request.url, request.headers, request.parameters ?? null,
        request.mimeType, request.uri);
      throwIfAborted(request.signal);
      return result;
    } catch (error) {
      if (request.signal.aborted) throw new TranscriptionError('cancelled');
      const code = (error as { code?: unknown } | null)?.code;
      throw new TranscriptionError(code === 'E_TRANSCRIPTION_SIZE' ? 'file-too-large'
        : code === 'E_TRANSCRIPTION_FILE' ? 'unsupported-file'
        : code === 'E_TRANSCRIPTION_TIMEOUT' ? 'timeout'
        : code === 'E_TRANSCRIPTION_RESPONSE' ? 'invalid-response'
        : code === 'E_TRANSCRIPTION_REQUEST' ? 'invalid-request' : 'network');
    } finally { request.signal.removeEventListener('abort', cancel); }
  },
};
