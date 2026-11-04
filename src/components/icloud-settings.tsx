import { Alert, View } from 'react-native';
import { Button, ListGroup, Spinner, Switch } from 'heroui-native';
import { LearnMore } from './learn-more';
import { SheetLead, SheetPoint } from './sheet';
import { AppText } from './screen';
import { useICloud } from '@/contexts/icloud-context';

const lastSynced = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Everything beyond the switch: how sync works, the latest result, and a manual run. */
function ICloudDetails() {
  const cloud = useICloud();
  return <>
    <SheetLead>Your recordings, transcripts, summaries and notes on all your Apple devices.</SheetLead>
    <View className="gap-3 pt-1">
      <SheetPoint icon="folder-outline">Files → iCloud Drive → OpenPocket, with a folder for each day.</SheetPoint>
      <SheetPoint icon="person-circle-outline">Use the same Apple account on every device.</SheetPoint>
      <SheetPoint icon="lock-closed-outline">API keys and sign-ins never leave this iPhone.</SheetPoint>
      <SheetPoint icon="shield-checkmark-outline">Nothing is deleted: turning sync off keeps every copy.</SheetPoint>
    </View>
    {!cloud.enabled && cloud.availability && !cloud.availability.available && <AppText className="text-sm text-warning">{cloud.availability.reason}</AppText>}
    {cloud.enabled && cloud.result && <View className="gap-1 pt-1" accessibilityLiveRegion="polite">
      <AppText className="text-xs text-muted">{cloud.result.pending
        ? `${cloud.result.pending} updates waiting for iCloud.` : 'Up to date on this iPhone.'}</AppText>
      {cloud.result.conflicts > 0 && <AppText className="text-xs text-warning">{cloud.result.conflicts} conflicting files kept in iCloud for review.</AppText>}
    </View>}
  </>;
}

/** The Settings row: switch, one status line, and ⓘ for the details sheet. */
export function ICloudRow() {
  const cloud = useICloud();
  const change = (enabled: boolean) => {
    if (!enabled) { void cloud.setEnabled(false); return; }
    Alert.alert(cloud.needsConfirmation ? 'Use the current iCloud account?' : 'Turn on iCloud sync?',
      'Copy your downloaded recordings, completed transcripts, AI summaries, and saved notes to the current Apple account’s iCloud Drive. OpenPocket will also download recordings and text from this app’s iCloud folder.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn on', onPress: () => void cloud.setEnabled(true) }]);
  };
  const working = cloud.loading || cloud.saving || cloud.busy;
  return (
    <ListGroup.Item accessible={false}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>iCloud sync</ListGroup.ItemTitle>
        <ListGroup.ItemDescription accessibilityLiveRegion="polite">{working
          ? cloud.loading ? 'Loading…' : cloud.saving ? 'Saving…' : cloud.stage ?? 'Syncing…'
          : !cloud.enabled ? 'Off' : cloud.lastCheckedAt ? `Last synced ${lastSynced(cloud.lastCheckedAt)}` : 'Not synced yet'}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix className="flex-row items-center gap-3">
        {working && <Spinner size="sm" />}
        <LearnMore title="iCloud sync" icon primary={cloud.enabled ? { label: cloud.busy ? 'Syncing…' : 'Sync now',
          isDisabled: cloud.busy || cloud.saving, onPress: () => void cloud.sync() } : undefined}><ICloudDetails /></LearnMore>
        <Switch accessibilityLabel="iCloud sync" isSelected={cloud.enabled}
          isDisabled={cloud.loading || cloud.saving} onSelectedChange={change} />
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}

/** Errors and the opt-out retry, shown under the Settings group rather than inside a row. */
export function ICloudIssues() {
  const cloud = useICloud();
  if (!cloud.error && !cloud.unsavedOptOut) return null;
  return <View className="items-start gap-2 px-1">
    {cloud.error && <AppText className="text-sm text-danger" accessibilityRole="alert">{cloud.error}</AppText>}
    {cloud.unsavedOptOut && <Button size="sm" variant="secondary" isDisabled={cloud.saving}
      onPress={() => void cloud.setEnabled(false)}>Retry saving Off</Button>}
  </View>;
}
