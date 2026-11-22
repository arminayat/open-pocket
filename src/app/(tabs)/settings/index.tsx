import { View } from 'react-native';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { Button, ListGroup, Separator, Switch } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/app-theme-context';
import { usePocket } from '@/contexts/pocket-context';
import { Screen } from '@/components/screen';
import { AiRow } from '@/components/ai-settings';
import { ICloudIssues, ICloudRow } from '@/components/icloud-settings';
import { LearnMore } from '@/components/learn-more';
import { RecorderSection } from '@/components/recorder-section';
import { Section } from '@/components/settings-parts';
import { SheetLead, SheetPoint } from '@/components/sheet';
import { TranscriptionRow } from '@/components/transcription-settings';

function AutoDownloadRow() {
  const pocket = usePocket();
  return (
    <ListGroup.Item accessible={false}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>Download new recordings</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>{pocket.autoDownload ? 'Over Bluetooth, while Pocket is nearby' : 'Off'}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix className="flex-row items-center gap-3">
        <LearnMore title="Automatic download" icon>
          <SheetLead>New recordings save to this iPhone on their own.</SheetLead>
          <View className="gap-3 pt-1">
            <SheetPoint icon="bluetooth">Over Bluetooth while Pocket is nearby, so you stay on Wi-Fi.</SheetPoint>
            <SheetPoint icon="moon-outline">Keeps going while Open Pocket is in the background.</SheetPoint>
            <SheetPoint icon="refresh">Anything that fails retries the next time Pocket connects.</SheetPoint>
          </View>
        </LearnMore>
        <Switch isSelected={pocket.autoDownload} onSelectedChange={pocket.setAutoDownload}
          accessibilityLabel="Download new recordings automatically" />
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

const version = Constants.expoConfig?.version ?? '0.1.0';
const build = Constants.expoConfig?.ios?.buildNumber;
/** Shown under the last section, like the Mac app's Settings footer. */
const ABOUT = `Open Pocket ${version}${build ? ` (${build})` : ''} · unofficial, not affiliated with the maker of Pocket`;

/** Diagnostics live on their own page, reached from the bottom of Settings. */
function DebugRow() {
  const router = useRouter();
  return (
    <ListGroup.Item accessibilityRole="button" onPress={() => router.push('/settings/debug')}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>Debug</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>Connection log and diagnostic report</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix />
    </ListGroup.Item>
  );
}

export default function SettingsScreen() {
  const { isDark, toggleTheme } = useAppTheme();
  return (
    <Screen>
      <Stack.Screen options={{
        headerRight: () => <Button isIconOnly variant="ghost" accessibilityLabel="Switch color theme" onPress={toggleTheme}>
          <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={isDark ? '#fafafa' : '#18181b'} />
        </Button>,
      }} />
      <RecorderSection />
      <Section title="Recordings">
        <ListGroup>
          <AutoDownloadRow />
          <Separator className="mx-4" />
          <ICloudRow />
        </ListGroup>
        <ICloudIssues />
      </Section>
      <Section title="Transcripts">
        <ListGroup>
          <TranscriptionRow />
          <Separator className="mx-4" />
          <AiRow />
        </ListGroup>
      </Section>
      <Section title="Troubleshooting" footer={ABOUT}>
        <ListGroup>
          <DebugRow />
        </ListGroup>
      </Section>
    </Screen>
  );
}
