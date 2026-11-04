import { useRef } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Spinner, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActionButton } from '@/components/action-button';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { useConnected } from '@/components/ai-settings';
import { useNoteMarkdownStyle } from '@/components/note-editor';
import { AppText } from '@/components/screen';
import { useAi } from '@/contexts/ai-context';
import { useTranscription } from '@/contexts/transcription-context';
import { getAiProvider } from '@/lib/ai/providers';
import type { LocalRecording } from '@/lib/pocket/types';
import { recordingKey } from '@/lib/transcription/state';

/** An AI-written title and summary of the transcript. Read-only: it is generated, never typed. */
export function RecordingSummary({ recording }: { recording: LocalRecording }) {
  const ai = useAi();
  const transcription = useTranscription();
  const router = useRouter();
  const [muted, foreground] = useThemeColor(['muted', 'foreground']);
  const { style } = useNoteMarkdownStyle();
  const confirming = useRef(false);
  const key = recordingKey(recording);
  const entry = ai.entries[key];
  const transcript = transcription.entries[key];
  const text = transcript?.status === 'complete' ? transcript.text?.trim() ?? '' : '';
  const provider = getAiProvider(ai.selectedProvider);
  const connected = useConnected(provider.id);
  const active = ai.active?.recordingKey === key;
  const busy = ai.loading || ai.saving || Boolean(ai.active);
  const failure = ai.failures[key];

  const confirm = () => {
    if (busy || !text || confirming.current) return;
    confirming.current = true;
    Alert.alert(`${entry ? 'Rewrite' : 'Write'} the summary with ${provider.name}?`,
      `This sends the transcript text (not the audio) to ${provider.name}. ${provider.billing}${entry ? ' The current summary is replaced.' : ''}`, [
        { text: 'Cancel', style: 'cancel', onPress: () => { confirming.current = false; } },
        { text: entry ? 'Rewrite' : 'Summarize', onPress: () => { confirming.current = false; void ai.generate(recording, text); } },
      ], { cancelable: true, onDismiss: () => { confirming.current = false; } });
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Card.Title className="flex-1">Summary</Card.Title>
        {entry && connected && Boolean(text) && !active
          ? <Button isIconOnly size="sm" variant="ghost" className="-my-2 -mr-2" isDisabled={busy} accessibilityLabel="Rewrite summary" onPress={confirm}>
            <Ionicons name="refresh" size={20} color={foreground} />
          </Button>
          : <Ionicons name="sparkles-outline" size={16} color={muted} />}
      </View>
      {active ? <>
        <View className="flex-row items-center gap-2" accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
          <Spinner size="sm" /><AppText className="flex-1 text-sm text-muted">Writing with {provider.name}…</AppText>
        </View>
        <View className="items-start"><ActionButton icon="close" label="Cancel" onPress={ai.cancel} /></View>
      </> : <>
        {entry ? <>
          <EnrichedMarkdownText markdown={entry.summary} markdownStyle={style} />
          <AppText className="text-xs text-muted">Written by {getAiProvider(entry.provider).name} · {entry.model}</AppText>
        </> : <AppText className="text-sm leading-5 text-muted">{!text
          ? 'A title and summary are written automatically from the transcript. Transcribe this recording first.'
          : 'A title and summary written from the transcript.'}</AppText>}
        {failure && <AppText className="text-sm text-danger" accessibilityRole="alert">{failure}</AppText>}
        {Boolean(text) && (connected
          ? !entry && <View className="items-start"><ActionButton icon="sparkles-outline" isDisabled={busy}
              label={`Summarize with ${provider.name}`} onPress={confirm} /></View>
          : <>
            <AppText className="text-sm text-muted">Connect an AI provider to write summaries.</AppText>
            <View className="items-start"><ActionButton icon="settings-outline" label="AI settings" onPress={() => router.push('/settings/ai')} /></View>
          </>)}
      </>}
    </View>
  );
}
