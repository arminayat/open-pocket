import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Button, Card, ListGroup, Separator, Spinner, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { usePocket } from '@/contexts/pocket-context';
import { Screen } from '@/components/screen';
import { Section } from '@/components/settings-parts';
import { useAi } from '@/contexts/ai-context';
import { summaryFor } from '@/lib/ai/auto';
import { formatDuration, latestCopy, mergeRecordings, recordingTime } from '@/lib/pocket/recording-list';

export default function RecordingsScreen() {
  const pocket = usePocket();
  const ai = useAi();
  const router = useRouter();
  const [success, foreground, muted] = useThemeColor(['success', 'foreground', 'muted']);
  const records = mergeRecordings(pocket.recordings, pocket.library);
  const dates = [...new Set(records.map(item => item.date))];
  const setupNeeded = pocket.busy !== 'loading' && !pocket.saved && !records.length;
  return (
    <Screen subtitle={pocket.autoDownload ? 'New recordings are saved to this iPhone automatically.' : 'Automatic download is off in Settings.'}>
      <Stack.Screen options={{
        headerRight: () => pocket.device && (pocket.busy === 'listing' ? <Spinner size="sm" />
          : <Button isIconOnly variant="ghost" isDisabled={Boolean(pocket.busy)} accessibilityLabel="Refresh recordings" onPress={() => void pocket.refresh()}>
            <Ionicons name="refresh" size={22} color={foreground} />
          </Button>),
      }} />
      {/* A first launch with nothing saved: lead straight to the setup steps in Settings. */}
      {setupNeeded ? <Card><Card.Body className="gap-3">
        <Card.Title>Set up your Pocket</Card.Title>
        <Card.Description>Connect your recorder once, and new recordings save to this iPhone on their own.</Card.Description>
        <Button variant="primary" onPress={() => router.navigate('/(tabs)/settings')}>Set up Pocket</Button>
      </Card.Body></Card>
        : !records.length && <Card><Card.Body className="gap-2"><Card.Title>No recordings yet</Card.Title><Card.Description>{pocket.device ? 'Tap refresh to read recordings from Pocket.' : 'Connect your recorder to see what is available.'}</Card.Description></Card.Body></Card>}
      {dates.map(date => <Section key={date} title={date}>
        <ListGroup>
          {records.filter(item => item.date === date).map((recording, index) => {
            const saved = Boolean(latestCopy(pocket.library, recording.id));
            const downloading = pocket.progress?.recordingId === recording.id;
            const state = downloading ? 'saving' : saved ? 'saved on this iPhone' : 'on Pocket';
            const title = summaryFor(pocket.library, ai.entries, recording.id)?.title;
            const time = recordingTime(recording);
            const duration = formatDuration(recording.durationSeconds);
            return <View key={recording.id}>
              {index > 0 && <Separator className="mx-4" />}
              <ListGroup.Item accessibilityRole="button" accessibilityLabel={`${title ? `${title}, ` : ''}${time}, ${duration}, ${state}`}
                onPress={() => router.push({ pathname: '/recordings/[id]', params: { id: recording.id } })}>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle numberOfLines={1}>{title ?? time}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>{title ? `${time} · ${duration}` : duration}</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix className="flex-row items-center gap-2">
                  {downloading ? <Spinner size="sm" />
                    : <Ionicons name={saved ? 'checkmark-circle' : 'cloud-download-outline'} size={18} color={saved ? success : muted} />}
                  <Ionicons name="chevron-forward" size={16} color={muted} />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </View>;
          })}
        </ListGroup>
      </Section>)}
    </Screen>
  );
}
