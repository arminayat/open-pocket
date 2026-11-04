import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Button, Card, Spinner, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { usePocket } from '@/contexts/pocket-context';
import { useTranscription } from '@/contexts/transcription-context';
import { useAi } from '@/contexts/ai-context';
import { summaryFor } from '@/lib/ai/auto';
import { AppText, Screen } from '@/components/screen';
import { RecordingPlayer } from '@/components/recording-player';
import { ActionButton } from '@/components/action-button';
import { RecordingNotes } from '@/components/recording-notes';
import { RecordingSummary } from '@/components/recording-summary';
import { RecordingTranscript } from '@/components/recording-transcript';
import { safeErrorMessage } from '@/lib/diagnostics';
import { formatDuration, latestCopy, mergeRecordings, recordingTime } from '@/lib/pocket/recording-list';
import type { LocalRecording } from '@/lib/pocket/types';

export default function RecordingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pocket = usePocket();
  const transcription = useTranscription();
  const ai = useAi();
  const foreground = useThemeColor('foreground');
  const [shareError, setShareError] = useState<string | null>(null);
  const recording = mergeRecordings(pocket.recordings, pocket.library).find(item => item.id === id);
  const file = latestCopy(pocket.library, id);
  const downloading = pocket.progress?.recordingId === id;
  const title = summaryFor(pocket.library, ai.entries, id)?.title;

  const share = async (local: LocalRecording) => {
    setShareError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      await Sharing.shareAsync(local.uri, { mimeType: 'audio/mpeg', UTI: 'public.mp3' });
    } catch (error) { setShareError(safeErrorMessage(error)); }
  };

  if (!recording) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Recording' }} />
        <Card><Card.Body className="gap-2"><Card.Title>Recording unavailable</Card.Title>
          <Card.Description>It is no longer on Pocket or this iPhone.</Card.Description></Card.Body></Card>
      </Screen>
    );
  }
  return (
    <Screen subtitle={`${recording.date} · ${title ? `${recordingTime(recording)} · ` : ''}${formatDuration(recording.durationSeconds)}`}>
      <Stack.Screen options={{
        title: title ?? recordingTime(recording),
        headerRight: () => file && <Button isIconOnly variant="ghost" accessibilityLabel="Share MP3" onPress={() => void share(file)}>
          <Ionicons name="share-outline" size={22} color={foreground} />
        </Button>,
      }} />
      {shareError && <AppText className="text-sm text-danger">{shareError}</AppText>}
      {transcription.error && <View className="items-start gap-2">
        <AppText className="text-sm text-danger" accessibilityRole="alert">{transcription.error}</AppText>
        <ActionButton icon="close" label="Dismiss" onPress={transcription.clearError} />
      </View>}
      {!file && <Card><Card.Body className="flex-row items-center gap-3" accessibilityLiveRegion="polite">
        {downloading && <Spinner size="sm" />}
        <Card.Description className="flex-1">
          {downloading ? 'Saving to this iPhone…' : pocket.autoDownload ? 'Still on Pocket. It is saved here automatically while Pocket is connected.' : 'Still on Pocket. Automatic download is off in Settings.'}
        </Card.Description>
      </Card.Body></Card>}
      {file && <RecordingPlayer key={file.uri} recording={file} />}
      {file && <Card><Card.Body><RecordingSummary recording={file} /></Card.Body></Card>}
      {file && <Card><Card.Body><RecordingNotes recording={file} /></Card.Body></Card>}
      {file && <Card><Card.Body><RecordingTranscript recording={file} /></Card.Body></Card>}
    </Screen>
  );
}
