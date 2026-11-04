import { useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { Button, Card } from 'heroui-native';
import { File, Paths } from 'expo-file-system';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { AppText, Screen } from '@/components/screen';
import { diagnostics, safeErrorMessage } from '@/lib/diagnostics';
import { usePocket } from '@/contexts/pocket-context';

export default function DebugScreen() {
  const entries = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot);
  const { info, busy } = usePocket();
  const [error, setError] = useState<string | null>(null);
  const exportReport = async () => {
    setError(null);
    try {
      const file = new File(Paths.cache, 'openpocket-diagnostics.txt');
      file.write(diagnostics.exportReport({ version: '0.1.0', firmware: info?.firmware ?? 'unknown', wifiFirmware: info?.wifiFirmware ?? 'unknown' }));
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', UTI: 'public.plain-text' });
    } catch (cause) { setError(safeErrorMessage(cause)); }
  };
  return (
    <Screen subtitle="See which part of the connection needs attention.">
      <Stack.Screen options={{ title: 'Debug' }} />
      <Card><Card.Body className="gap-3">
        <Card.Title>{busy ? `Working: ${busy}` : 'Ready for a test'}</Card.Title>
        <Card.Description>Reports include connection stages and transfer counts. Account identifiers, device identifiers, keys, and passwords are removed.</Card.Description>
        <Button variant="secondary" onPress={() => void exportReport()}>Export diagnostic report</Button>
        {error && <AppText className="text-sm text-danger">{error}</AppText>}
      </Card.Body></Card>
      {!entries.length && <AppText className="text-sm text-muted">Connect your Pocket to start collecting diagnostics.</AppText>}
      {[...entries].reverse().map(entry => <View key={entry.id} className="gap-1 border-b border-separator pb-3">
        <AppText className="text-xs text-muted">{entry.timestamp} · {entry.stage}</AppText>
        <AppText className="text-sm">{entry.message}</AppText>
        {entry.details && Object.keys(entry.details).length > 0 && <AppText className="text-xs text-muted">{Object.entries(entry.details).map(([key, value]) => `${key}: ${value}`).join(' · ')}</AppText>}
      </View>)}
    </Screen>
  );
}
