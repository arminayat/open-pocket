import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Input, Label, Spinner, TextField } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { usePocket } from '@/contexts/pocket-context';
import { useAppTheme } from '@/contexts/app-theme-context';
import { AppText, Screen } from '@/components/screen';
import { ErrorNotice } from '@/components/error-notice';

export default function DeviceScreen() {
  const pocket = usePocket();
  const { isDark, toggleTheme } = useAppTheme();
  const [advanced, setAdvanced] = useState(false);
  const [mode, setMode] = useState<'api-key' | 'device-key'>('api-key');
  const [input, setInput] = useState('');
  const disabled = Boolean(pocket.busy);
  const connected = Boolean(pocket.device);
  const credentialVerified = pocket.credential?.key === pocket.saved?.key && Boolean(pocket.saved);
  const importCredential = async () => {
    const value = input;
    setInput('');
    if (mode === 'api-key') await pocket.importApiKey(value);
    else await pocket.importDeviceKey(value);
  };
  return (
    <Screen title="Your Pocket" subtitle="Bring your recordings straight to your phone."
      action={<Button isIconOnly variant="ghost" accessibilityLabel="Switch color theme" onPress={toggleTheme}><Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={isDark ? '#fafafa' : '#18181b'} /></Button>}>
      <ErrorNotice />
      <Card>
        <Card.Body className="gap-4">
          <View className="flex-row items-center justify-between">
            <View className="h-20 w-14 items-center justify-center rounded-2xl bg-foreground">
              <View className="mb-2 h-1 w-5 rounded-full bg-background opacity-50" />
              <Ionicons name="mic-outline" size={28} color={isDark ? '#18181b' : '#fafafa'} />
              <View className={`mt-2 h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-muted'}`} />
            </View>
            <Chip variant="soft" color={connected ? 'success' : 'default'}>{connected ? 'Connected' : 'Ready to connect'}</Chip>
          </View>
          <View className="gap-1">
            <Card.Title>{pocket.device?.name || 'Pocket recorder'}</Card.Title>
            <Card.Description>{connected ? 'Direct connection is ready.' : 'Keep Pocket nearby and awake. Close the official app so OpenPocket can connect.'}</Card.Description>
          </View>
          {pocket.info && <View className="flex-row flex-wrap gap-2">
            <Chip variant="soft">Battery {pocket.info.battery === null ? '—' : `${pocket.info.battery}%`}</Chip>
            <Chip variant="soft">Firmware {pocket.info.firmware}</Chip>
          </View>}
          {connected ? <Button variant="secondary" isDisabled={disabled} onPress={() => void pocket.disconnect()}>Disconnect</Button>
            : pocket.saved && <Button variant="primary" isDisabled={disabled} onPress={() => void pocket.reconnect()}>Reconnect saved Pocket</Button>}
        </Card.Body>
      </Card>

      {!connected && <Card>
        <Card.Body className="gap-3">
          <Card.Title>1. Connect your Pocket account</Card.Title>
          <Card.Description>{pocket.credential ? pocket.credential.accountLabel : 'Use the same account that is paired with your recorder.'}</Card.Description>
          {pocket.credential && <AppText className="text-xs text-muted">{credentialVerified ? 'A verified connection is saved on this iPhone.' : 'Credential ready. Select a recorder to verify the device key.'}</AppText>}
          <Button isDisabled={disabled} variant={pocket.credential ? 'secondary' : 'primary'} onPress={() => void pocket.signIn()}>
            {pocket.credential ? 'Sign in with another account' : 'Sign in to Pocket'}
          </Button>
          <AppText className="text-xs leading-5 text-muted">Pocket’s sign-in permission includes access to cloud recordings. OpenPocket uses it to identify your account; recordings download directly from your device.</AppText>
          <Button variant="ghost" size="sm" isDisabled={disabled} onPress={() => setAdvanced(!advanced)}>{advanced ? 'Hide advanced connection' : 'Advanced connection'}</Button>
          {advanced && <View className="gap-3">
            <View className="flex-row gap-2">
              <Button size="sm" variant={mode === 'api-key' ? 'secondary' : 'ghost'} onPress={() => { setMode('api-key'); setInput(''); }}>Personal API key</Button>
              <Button size="sm" variant={mode === 'device-key' ? 'secondary' : 'ghost'} onPress={() => { setMode('device-key'); setInput(''); }}>Device key</Button>
            </View>
            <TextField>
              <Label>{mode === 'api-key' ? 'Pocket personal API key' : 'Known 16-character device key'}</Label>
              <Input value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="none" placeholder={mode === 'api-key' ? 'pk_…' : 'Enter device key'} />
            </TextField>
            <AppText className="text-xs text-muted">{mode === 'api-key' ? 'Find your personal key in Pocket Settings → Developer → API Keys.' : 'Use an existing key from your own activated recorder.'}</AppText>
            <Button variant="secondary" isDisabled={disabled || !input} onPress={() => void importCredential()}>Use this key</Button>
          </View>}
        </Card.Body>
      </Card>}

      {!connected && <Card>
        <Card.Body className="gap-3">
          <Card.Title>2. Choose your recorder</Card.Title>
          <Card.Description>Press Pocket’s button to wake it, then scan nearby.</Card.Description>
          <Button variant="secondary" isDisabled={disabled && pocket.busy !== 'scan'} onPress={() => pocket.busy === 'scan' ? pocket.stopScan() : void pocket.scan()}>
            {pocket.busy === 'scan' ? 'Stop scanning' : 'Find nearby Pocket'}
          </Button>
          {pocket.nearby.map(device => <View key={device.id} className="flex-row items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3">
            <View className="flex-1 gap-1">
              <AppText>{device.name}</AppText>
              <AppText className="text-xs text-muted">{device.rssi === null ? 'Nearby' : `Signal ${device.rssi} dBm`}</AppText>
            </View>
            <Button size="sm" isDisabled={disabled || !pocket.credential} onPress={() => void pocket.connect(device)}>Connect</Button>
          </View>)}
          {!pocket.nearby.length && <AppText className="text-xs text-muted">If nothing appears, check Bluetooth and release Pocket’s connection to other phones or apps.</AppText>}
        </Card.Body>
      </Card>}

      {pocket.busy && <View className="flex-row items-center gap-3" accessibilityLiveRegion="polite"><Spinner size="sm" /><AppText className="text-sm text-muted">{pocket.busy === 'scan' ? 'Looking for Pocket…' : `${pocket.busy.replace('-', ' ')}…`}</AppText></View>}
      {pocket.credential && <Button variant="ghost" isDisabled={disabled} onPress={() => void pocket.forget()}>Forget saved connection</Button>}
      <AppText className="text-xs leading-5 text-muted">Your recorder must already be activated in the official Pocket app. OpenPocket keeps recordings on this iPhone and never deletes them from the recorder.</AppText>
    </Screen>
  );
}
