import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type NativeTranscription = {
  reserve(): string;
  upload(id: string, url: string, headers: Record<string, string>, parameters: Record<string, string> | null,
    mimeType: string, uri: string): Promise<{ status: number; body: string }>;
  cancel(id: string): void;
};

const native = requireOptionalNativeModule<NativeTranscription>('PocketTranscription');

export function requireTranscriptionNative(): NativeTranscription {
  if (Platform.OS !== 'ios' || !native) {
    throw new Error('Transcription needs the latest OpenPocket iPhone development build.');
  }
  return native;
}
