import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Input, Label, TextField, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { usePocket } from '@/contexts/pocket-context';
import type { PocketDevice } from '@/lib/pocket/types';
import { AppText } from '@/components/screen';
import { ChatGPTConnection } from '@/components/chatgpt-connection';

type StepState = 'done' | 'current' | 'upcoming';

function StepCard({ number, title, summary, state, last, children }: {
  number: number; title: string; summary: string; state: StepState; last?: boolean; children?: React.ReactNode;
}) {
  const onSuccess = useThemeColor('success-foreground');
  const label = state === 'done' ? 'completed' : state === 'current' ? 'current step' : 'not started';
  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View accessibilityLabel={`Step ${number}, ${label}`}
          className={`h-8 w-8 items-center justify-center rounded-full ${state === 'done' ? 'bg-success' : state === 'current' ? 'bg-foreground' : 'border border-separator'}`}>
          {state === 'done' ? <Ionicons name="checkmark" size={18} color={onSuccess} />
            : <AppText className={`text-sm ${state === 'current' ? 'text-background' : 'text-muted'}`} style={{ fontFamily: 'Inter_600SemiBold' }}>{number}</AppText>}
        </View>
        {!last && <View className={`mt-1 w-0.5 flex-1 ${state === 'done' ? 'bg-success' : 'bg-separator'}`} />}
      </View>
      <Card className={`mb-4 flex-1 ${state === 'upcoming' ? 'opacity-60' : ''}`}>
        <Card.Body className="gap-3">
          <View className="gap-1">
            <Card.Title>{title}</Card.Title>
            <Card.Description>{summary}</Card.Description>
          </View>
          {state !== 'upcoming' && children}
        </Card.Body>
      </Card>
    </View>
  );
}

function AccountStep({ state }: { state: StepState }) {
  const pocket = usePocket();
  const [advanced, setAdvanced] = useState(false);
  const [mode, setMode] = useState<'api-key' | 'device-key'>('api-key');
  const [input, setInput] = useState('');
  const disabled = Boolean(pocket.busy);
  const importCredential = async () => {
    const value = input;
    setInput('');
    if (mode === 'api-key') await pocket.importApiKey(value);
    else await pocket.importDeviceKey(value);
  };
  return (
    <StepCard number={1} title="Sign in to Pocket" state={state}
      summary={pocket.credential ? pocket.credential.accountLabel : 'Use the same account that is paired with your recorder.'}>
      <Button isDisabled={disabled} variant={state === 'done' ? 'ghost' : 'primary'} size={state === 'done' ? 'sm' : 'md'}
        onPress={() => void pocket.signIn()}>
        {state === 'done' ? 'Use another account' : 'Sign in to Pocket'}
      </Button>
      {state !== 'done' && <>
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
      </>}
    </StepCard>
  );
}

function RecorderStep({ state, selected, onSelect }: {
  state: StepState; selected: PocketDevice | null; onSelect: (device: PocketDevice | null) => void;
}) {
  const pocket = usePocket();
  const disabled = Boolean(pocket.busy);
  const scanning = pocket.busy === 'scan';
  if (state === 'done' && selected) {
    return (
      <StepCard number={2} title="Choose your recorder" state={state} summary={selected.name}>
        <Button variant="ghost" size="sm" isDisabled={disabled} onPress={() => onSelect(null)}>Choose a different recorder</Button>
      </StepCard>
    );
  }
  return (
    <StepCard number={2} title="Choose your recorder" state={state} summary="Press Pocket’s button to wake it, then scan nearby.">
      <Button variant="secondary" isDisabled={disabled && !scanning} onPress={() => scanning ? pocket.stopScan() : void pocket.scan()}>
        {scanning ? 'Stop scanning' : 'Find nearby Pocket'}
      </Button>
      {pocket.nearby.map(device => <View key={device.id} className="flex-row items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3">
        <View className="flex-1 gap-1">
          <AppText>{device.name}</AppText>
          <AppText className="text-xs text-muted">{device.rssi === null ? 'Nearby' : `Signal ${device.rssi} dBm`}</AppText>
        </View>
        <Button size="sm" onPress={() => { if (scanning) pocket.stopScan(); onSelect(device); }}>Select</Button>
      </View>)}
      {!pocket.nearby.length && <AppText className="text-xs text-muted">If nothing appears, check Bluetooth and release Pocket’s connection to other phones or apps.</AppText>}
    </StepCard>
  );
}

function ConnectStep({ state, selected }: { state: StepState; selected: PocketDevice | null }) {
  const pocket = usePocket();
  return (
    <StepCard number={3} title="Connect and verify" state={state} last
      summary={state === 'upcoming' ? 'OpenPocket checks that your recorder accepts this account.' : `Keep ${selected?.name ?? 'Pocket'} nearby and awake, and close the official app.`}>
      {selected && <Button variant="primary" isDisabled={Boolean(pocket.busy)} onPress={() => void pocket.connect(selected)}>
        {pocket.busy === 'connect' ? 'Connecting…' : 'Connect'}
      </Button>}
    </StepCard>
  );
}

/** First-run checklist. Completion is the verified saved connection owned by PocketContext. */
export function SetupSteps() {
  const pocket = usePocket();
  const [choice, setSelected] = useState<PocketDevice | null>(null);
  // A new scan or "Start over" clears the nearby list, which also clears a stale choice.
  const selected = choice && pocket.nearby.some(device => device.id === choice.id) ? choice : null;
  const signedIn = Boolean(pocket.credential);
  const chosen = signedIn && Boolean(selected);
  const step = !signedIn ? 1 : !chosen ? 2 : 3;
  const stateOf = (index: number): StepState => index < step ? 'done' : index === step ? 'current' : 'upcoming';
  return (
    <View>
      <AccountStep state={stateOf(1)} />
      <RecorderStep state={stateOf(2)} selected={selected} onSelect={setSelected} />
      <ConnectStep state={stateOf(3)} selected={selected} />
      <ChatGPTConnection optional />
    </View>
  );
}
