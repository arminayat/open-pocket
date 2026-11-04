import { Stack } from 'expo-router';
import { Screen } from '@/components/screen';
import { TranscriptionSettings } from '@/components/transcription-settings';

export default function TranscriptionScreen() {
  return (
    <Screen subtitle="Choose a provider and add your own API key. API usage is billed separately from ChatGPT.">
      <Stack.Screen options={{ title: 'Transcription' }} />
      <TranscriptionSettings />
    </Screen>
  );
}
