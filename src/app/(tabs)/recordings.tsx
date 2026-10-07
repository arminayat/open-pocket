import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Spinner } from 'heroui-native';
import * as Sharing from 'expo-sharing';
import { usePocket } from '@/contexts/pocket-context';
import { AppText, Screen } from '@/components/screen';
import { ErrorNotice } from '@/components/error-notice';
import { RecordingPlayer } from '@/components/recording-player';
import type { LocalRecording, Transport } from '@/lib/pocket/types';
import { safeErrorMessage } from '@/lib/diagnostics';

const size = (bytes: number) => bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1_000)} KB`;
const duration = (seconds: number) => `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

export default function RecordingsScreen() {
  const pocket = usePocket();
  const [selection, setSelection] = useState<{ id: string; transport: Transport } | null>(null);
  const selected = selection ? pocket.library.find(file => file.id === selection.id && file.transport === selection.transport) : null;
  const [shareError, setShareError] = useState<string | null>(null);
  const disabled = Boolean(pocket.busy);
  const records = [...pocket.recordings];
  for (const local of pocket.library) if (!records.some(item => item.id === local.id)) records.push(local);
  records.sort((a, b) => `${b.date}${b.timestamp}`.localeCompare(`${a.date}${a.timestamp}`));
  const dates = [...new Set(records.map(item => item.date))];
  const share = async (file: LocalRecording) => {
    setShareError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      await Sharing.shareAsync(file.uri, { mimeType: 'audio/mpeg', UTI: 'public.mp3' });
    } catch (error) { setShareError(safeErrorMessage(error)); }
  };
  return (
    <Screen title="Recordings" subtitle="Download, listen, and keep a local copy.">
      <ErrorNotice />
      {!pocket.device && <Card><Card.Body><Card.Title>Your saved library</Card.Title><Card.Description>Connect Pocket in the Device tab to browse and download new recordings.</Card.Description></Card.Body></Card>}
      {pocket.device && <Button variant="secondary" isDisabled={disabled} onPress={() => void pocket.refresh()}>Refresh recordings</Button>}
      {selected && <RecordingPlayer key={selected.uri} recording={selected} />}
      {shareError && <AppText className="text-sm text-danger">{shareError}</AppText>}
      {pocket.progress && <Card>
        <Card.Body className="gap-3">
          <View className="flex-row items-center gap-3"><Spinner size="sm" /><Card.Title>{pocket.progress.stage}</Card.Title></View>
          <Card.Description>{pocket.progress.transport === 'wifi' ? 'Wi-Fi' : 'Bluetooth'} · {size(pocket.progress.receivedBytes)}{pocket.progress.expectedBytes > 0 ? ` of ${size(pocket.progress.expectedBytes)}` : ''}</Card.Description>
          <View className="h-2 overflow-hidden rounded-full bg-default" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pocket.progress.expectedBytes ? Math.round(pocket.progress.receivedBytes / pocket.progress.expectedBytes * 100) : 0 }}>
            <View className="h-2 rounded-full bg-accent" style={{ width: `${pocket.progress.expectedBytes ? Math.min(100, pocket.progress.receivedBytes / pocket.progress.expectedBytes * 100) : 0}%` }} />
          </View>
          <AppText className="text-xs text-muted">Keep OpenPocket open until the download finishes.</AppText>
          <Button variant="danger-soft" onPress={() => void pocket.cancel()}>Cancel download</Button>
        </Card.Body>
      </Card>}
      {!records.length && <Card><Card.Body className="gap-2"><Card.Title>No recordings yet</Card.Title><Card.Description>{pocket.device ? 'Refresh to read recordings from Pocket.' : 'Connect your recorder to see what is available.'}</Card.Description></Card.Body></Card>}
      {dates.map(date => <View key={date} className="gap-3">
        <AppText accessibilityRole="header" className="text-sm text-muted">{date}</AppText>
        {records.filter(item => item.date === date).map(recording => {
          const files = pocket.library.filter(item => item.id === recording.id);
          const onDevice = pocket.recordings.some(item => item.id === recording.id);
          return <Card key={recording.id}>
            <Card.Body className="gap-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 gap-1"><Card.Title>{recording.timestamp.length === 14 ? `${recording.timestamp.slice(8, 10)}:${recording.timestamp.slice(10, 12)}` : recording.timestamp}</Card.Title><Card.Description>{duration(recording.durationSeconds)}</Card.Description></View>
                {!!files.length && <Chip variant="soft" color="success">Saved</Chip>}
              </View>
              {pocket.device && onDevice && <View className="flex-row gap-2">
                <Button className="flex-1" size="sm" variant="secondary" isDisabled={disabled} onPress={() => void pocket.download(recording, 'bluetooth')}>Bluetooth</Button>
                <Button className="flex-1" size="sm" variant="secondary" isDisabled={disabled} onPress={() => void pocket.download(recording, 'wifi')}>Wi-Fi</Button>
              </View>}
              {files.map(file => <View key={file.uri} className="gap-2 border-t border-separator pt-3">
                <AppText className="text-xs text-muted">{file.transport === 'wifi' ? 'Wi-Fi copy' : 'Bluetooth copy'} · {size(file.bytes)}</AppText>
                <View className="flex-row gap-2">
                  <Button className="flex-1" size="sm" variant="tertiary" onPress={() => setSelection({ id: file.id, transport: file.transport })}>Listen</Button>
                  <Button className="flex-1" size="sm" variant="ghost" onPress={() => void share(file)}>Share MP3</Button>
                </View>
              </View>)}
            </Card.Body>
          </Card>;
        })}
      </View>)}
      <AppText className="text-xs leading-5 text-muted">Wi-Fi temporarily connects your iPhone to Pocket’s own network. OpenPocket leaves that network when the transfer ends.</AppText>
    </Screen>
  );
}
