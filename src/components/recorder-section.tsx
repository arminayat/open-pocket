import { View } from 'react-native';
import { Button, Card, Chip, Menu, Spinner } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { usePocket } from '@/contexts/pocket-context';
import { useAppTheme } from '@/contexts/app-theme-context';
import { AppText } from '@/components/screen';
import { PocketDevice } from '@/components/pocket-device';
import { recorderColor } from '@/lib/pocket/protocol';
import { Section } from '@/components/settings-parts';
import { SetupSteps } from '@/components/setup-steps';

type ChipColor = 'accent' | 'default' | 'success';

/** Recorder work in progress is shown on the card's chip instead of a separate status line. */
const ACTIVE_STATUS: Record<string, [label: string, color: ChipColor]> = {
  connect: ['Connecting…', 'accent'],
  listing: ['Checking recordings…', 'accent'],
  sync: ['Saving recordings…', 'accent'],
  download: ['Downloading…', 'accent'],
  disconnect: ['Disconnecting…', 'default'],
  forget: ['Forgetting…', 'default'],
};

/** Rare recorder actions stay out of the way in the card's overflow menu. */
function RecorderMenu() {
  const pocket = usePocket();
  const { isDark } = useAppTheme();
  const connected = Boolean(pocket.device);
  return (
    <Menu>
      <Menu.Trigger asChild>
        <Button isIconOnly size="sm" variant="ghost" className="-my-2 -mr-2" isDisabled={Boolean(pocket.busy)} accessibilityLabel="Recorder options">
          <Ionicons name="ellipsis-horizontal" size={20} color={isDark ? '#a1a1aa' : '#71717a'} />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay />
        <Menu.Content presentation="popover" width={220}>
          <Menu.Item onPress={() => void (connected ? pocket.disconnect() : pocket.reconnect())}>
            <Menu.ItemTitle>{connected ? 'Disconnect' : 'Reconnect'}</Menu.ItemTitle>
          </Menu.Item>
          <Menu.Item variant="danger" onPress={() => void pocket.forget()}>
            <Menu.ItemTitle>Forget this recorder</Menu.ItemTitle>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

function RecorderCard() {
  const pocket = usePocket();
  const connected = Boolean(pocket.device);
  const name = pocket.device?.name || pocket.saved?.device.name;
  const [status, color] = (pocket.busy && ACTIVE_STATUS[pocket.busy])
    || (connected ? ['Connected', 'success'] : ['Not connected', 'default']);
  return (
    <Card>
      <Card.Body className="flex-row gap-5">
        <PocketDevice connected={connected} color={recorderColor(name)} width={84} />
        <View className="flex-1 self-stretch justify-between gap-4 py-1">
          <View className="gap-1.5">
            <View className="flex-row items-center justify-between">
              <View accessibilityLiveRegion="polite"><Chip size="sm" variant="soft" color={color}>{status}</Chip></View>
              <RecorderMenu />
            </View>
            <Card.Title numberOfLines={1}>{name || 'Pocket recorder'}</Card.Title>
          </View>
          <AppText className="text-sm text-muted">
            {pocket.info ? `${pocket.info.battery === null ? '—' : `${pocket.info.battery}%`} battery · v${pocket.info.firmware}` : 'Keep Pocket nearby and awake.'}
          </AppText>
        </View>
      </Card.Body>
    </Card>
  );
}

/** The recorder at the top of Settings: its card once set up, otherwise the setup steps. */
export function RecorderSection() {
  const pocket = usePocket();
  const loading = pocket.busy === 'loading';
  const setupComplete = Boolean(pocket.saved);
  return (
    <Section title={setupComplete ? 'Recorder' : 'Set up your recorder'}
      footer="Your recorder must already be activated in the official Pocket app. OpenPocket keeps recordings on this iPhone and never deletes them from the recorder.">
      {!loading && (setupComplete ? <RecorderCard /> : <SetupSteps />)}
      {pocket.busy && !setupComplete && <View className="flex-row items-center gap-3" accessibilityLiveRegion="polite"><Spinner size="sm" /><AppText className="text-sm text-muted">{pocket.busy === 'scan' ? 'Looking for Pocket…' : pocket.busy === 'sync' ? 'Saving new recordings…' : `${pocket.busy.replace('-', ' ')}…`}</AppText></View>}
      {pocket.credential && !loading && !setupComplete && <Button variant="ghost" isDisabled={Boolean(pocket.busy)} onPress={() => void pocket.forget()}>Start over</Button>}
    </Section>
  );
}
