import { useEffect } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, ListGroup, Spinner, Switch } from 'heroui-native';
import { AppText } from '@/components/screen';
import { ApiKeyCard, ChoiceList, ErrorRow, LinkRows, Section } from '@/components/settings-parts';
import { usePocket } from '@/contexts/pocket-context';
import { useTranscription } from '@/contexts/transcription-context';
import { untranscribed } from '@/lib/transcription/auto';
import { knownModels, listsModels } from '@/lib/transcription/models';
import { getTranscriptionProvider, TRANSCRIPTION_PROVIDERS } from '@/lib/transcription/providers';
import type { ProviderId, TranscriptionProvider } from '@/lib/transcription/types';

function useBusy() {
  const transcription = useTranscription();
  return transcription.loading || transcription.saving || Boolean(transcription.active);
}

function ProviderList() {
  const transcription = useTranscription();
  return <ChoiceList label="providers" disabled={useBusy()} selected={transcription.selectedProvider}
    onSelect={id => void transcription.selectProvider(id as ProviderId)}
    items={TRANSCRIPTION_PROVIDERS.map(item => ({ id: item.id, title: item.name,
      description: `${transcription.savedProviders.includes(item.id) ? 'Key saved' : 'No key'} · up to ${Math.floor(item.maxBytes / 1_000_000)} MB per recording` }))} />;
}

/** Models come from the provider with the saved key where it can list them; otherwise the documented set. */
function ModelSection({ provider }: { provider: TranscriptionProvider }) {
  const transcription = useTranscription();
  const disabled = useBusy();
  const list = transcription.modelLists[provider.id];
  const selected = transcription.selectedModels[provider.id];
  const checking = list?.status === 'checking';
  const models = list?.models.length ? list.models : knownModels(provider.id);
  // Keep the current choice visible even if the provider stopped listing it.
  const shown = selected && !models.some(model => model.id === selected) ? [...models, { id: selected, label: selected, note: 'Not in the latest list' }] : models;
  const footer = checking ? 'Checking your key with the provider…'
    : list?.status === 'rejected' ? `${provider.name} rejected this API key. Replace it above; transcription will fail until then.`
    : list?.status === 'failed' ? `Couldn’t reach ${provider.name}. Showing its common models; refresh to check your key.`
    : list?.status === 'ready' ? listsModels(provider.id) ? 'Speech models this API key can use.' : `Key verified. ${provider.name} doesn’t list models by key, so these are its documented speech models.`
    : undefined;
  return (
    <Section title="Model" footer={footer} action={checking ? <Spinner size="sm" />
      : <Button size="sm" variant="ghost" className="-mr-3" isDisabled={disabled} onPress={() => void transcription.refreshModels(provider.id)}>Refresh</Button>}>
      <ChoiceList label="models" items={shown.map(model => ({ id: model.id, title: model.label, description: model.note }))}
        selected={selected} disabled={disabled} onSelect={id => void transcription.selectModel(provider.id, id)} />
    </Section>
  );
}

/** Opt-in, per provider: each automatic transcription is a billed upload, so turning it on is confirmed once. */
function AutoTranscribe({ provider }: { provider: TranscriptionProvider }) {
  const transcription = useTranscription();
  const { library } = usePocket();
  const disabled = useBusy();
  const saved = transcription.savedProviders.includes(provider.id);
  const change = (enabled: boolean) => {
    if (!enabled) { void transcription.setAutoTranscribe(false); return; }
    const count = untranscribed(library, transcription.entries).length;
    Alert.alert(`Transcribe automatically with ${provider.name}?`,
      `Open Pocket will upload each saved recording without a transcript to ${provider.name}, one at a time while the app is open, and your API account is billed for each. ${count === 1 ? '1 recording is' : `${count} recordings are`} waiting now. Recordings imported from iCloud are skipped. Failed transcriptions are not retried automatically.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn on', onPress: () => void transcription.setAutoTranscribe(true) }]);
  };
  const status = !saved ? `Save a ${provider.name} API key first.`
    : transcription.autoPaused ? 'Paused after a failed transcription. It continues with the next recording when you reopen Open Pocket.'
    : transcription.autoTranscribe ? 'Recordings without a transcript are transcribed while Open Pocket is open.' : undefined;
  return (
    <Section title="Automatic" footer={status}>
      <Card><Card.Body className="flex-row items-center gap-4">
        <View className="flex-1 gap-1">
          <Card.Title>Transcribe automatically</Card.Title>
          <Card.Description>Every recording without a transcript, using {provider.name}.</Card.Description>
        </View>
        <Switch accessibilityLabel="Transcribe automatically" isSelected={transcription.autoTranscribe}
          isDisabled={disabled || !saved} onSelectedChange={change} />
      </Card.Body></Card>
    </Section>
  );
}

/** The Settings row; the provider and key controls live on their own page. */
export function TranscriptionRow() {
  const transcription = useTranscription();
  const router = useRouter();
  const provider = getTranscriptionProvider(transcription.selectedProvider);
  const saved = transcription.savedProviders.includes(provider.id);
  return (
    <ListGroup.Item accessibilityRole="button" onPress={() => router.push('/settings/transcription')}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>Transcription</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>{transcription.loading ? 'Loading…' : saved
          ? `${provider.name} · ${knownModels(provider.id).find(model => model.id === transcription.selectedModels[provider.id])?.label ?? transcription.selectedModels[provider.id]}`
          : `${provider.name} · No API key yet`}{saved && transcription.autoTranscribe ? ' · Automatic' : ''}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix />
    </ListGroup.Item>
  );
}

/** The Transcription page: pick a provider, manage its key, and reach its account pages. */
export function TranscriptionSettings() {
  const transcription = useTranscription();
  const provider = getTranscriptionProvider(transcription.selectedProvider);
  const saved = transcription.savedProviders.includes(provider.id);
  const checked = Boolean(transcription.modelLists[provider.id]);
  const { refreshModels } = transcription;
  // Check a saved key once per session when its provider is shown.
  useEffect(() => { if (saved && !checked) void refreshModels(provider.id); }, [saved, checked, provider.id, refreshModels]);
  return (
    <View className="gap-6">
      {transcription.error && <ErrorRow message={transcription.error} onDismiss={transcription.clearError} />}
      {(transcription.loading || transcription.saving) && <View className="flex-row items-center gap-2"
        accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
        <Spinner size="sm" /><AppText className="text-sm text-muted">{transcription.loading ? 'Loading…' : 'Saving…'}</AppText>
      </View>}
      {transcription.active && <AppText className="text-sm text-muted">Finish or cancel the active transcription before changing providers or keys.</AppText>}
      <Section title="Provider" footer={transcription.autoTranscribe
        ? 'Automatic transcription is on: recordings without a transcript upload to the selected provider without asking each time.'
        : 'Each transcription asks before uploading a recording to the selected provider.'}>
        <ProviderList />
      </Section>
      <Section title={`${provider.name} API key`} intro={provider.description}
        footer={`Stored only on this iPhone. Removing it here does not revoke it at ${provider.name}.`}>
        <ApiKeyCard key={provider.id} name={provider.name} saved={saved} disabled={useBusy()}
          onSave={key => transcription.saveKey(provider.id, key)} onRemove={() => void transcription.removeKey(provider.id)} />
      </Section>
      {saved && <ModelSection provider={provider} />}
      <AutoTranscribe provider={provider} />
      <Section title={`${provider.name} account`}>
        <LinkRows name={provider.name} links={[
          { label: 'Get an API key', icon: 'key-outline', url: provider.apiKeyUrl },
          { label: 'Pricing', icon: 'pricetag-outline', url: provider.pricingUrl },
          { label: 'Privacy & data retention', icon: 'shield-checkmark-outline', url: provider.privacyUrl },
        ]} />
      </Section>
    </View>
  );
}
