import { Stack } from 'expo-router';
import { AiSettings } from '@/components/ai-settings';
import { Screen } from '@/components/screen';

export default function AiScreen() {
  return (
    <Screen subtitle="Choose who writes titles and summaries from your transcripts.">
      <Stack.Screen options={{ title: 'AI' }} />
      <AiSettings />
    </Screen>
  );
}
