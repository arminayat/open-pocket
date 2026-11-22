import { useEffect } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, ListGroup, Spinner, Switch } from 'heroui-native';
import { ChatGPTConnection } from '@/components/chatgpt-connection';
import { AppText } from '@/components/screen';
import { ApiKeyCard, ChoiceList, ErrorRow, LinkRows, Section } from '@/components/settings-parts';
import { useAi } from '@/contexts/ai-context';
import { useChatGPT } from '@/contexts/chatgpt-context';
import { usePocket } from '@/contexts/pocket-context';
import { useTranscription } from '@/contexts/transcription-context';
import { unsummarized } from '@/lib/ai/auto';
import { AI_PROVIDERS, getAiProvider, type AiProvider, type AiProviderId } from '@/lib/ai/providers';

function useBusy() {
  const ai = useAi();
  return ai.loading || ai.saving || Boolean(ai.active);
}

/** Whether the provider can be used now: a ChatGPT account with plan access, or a saved key. */
export function useConnected(id: AiProviderId): boolean {
  const ai = useAi();
  const chatgpt = useChatGPT();
  return id === 'chatgpt' ? chatgpt.profiles.some(profile => profile.active && profile.planEnabled) : ai.savedProviders.includes(id);
}

function useModelLabel(id: AiProviderId): string {
  const ai = useAi();
  const model = ai.selectedModels[id];
  return [...ai.modelLists[id]?.models ?? [], ...getAiProvider(id).models].find(item => item.id === model)?.label ?? model;
}

function ProviderList() {
  const ai = useAi();
  const chatgpt = useChatGPT();
  const signedIn = chatgpt.profiles.some(profile => profile.active && profile.planEnabled);
  return <ChoiceList label="providers" disabled={useBusy()} selected={ai.selectedProvider}
    onSelect={id => void ai.selectProvider(id as AiProviderId)}
    items={AI_PROVIDERS.map(item => ({ id: item.id, title: item.name,
      description: item.id === 'chatgpt' ? (signedIn ? 'Signed in · uses your plan' : 'Sign in with ChatGPT')
        : ai.savedProviders.includes(item.id) ? 'Key saved' : 'No key' }))} />;
}

function Credential({ provider }: { provider: AiProvider }) {
  const ai = useAi();
  const disabled = useBusy();
  if (provider.id === 'chatgpt') return <ChatGPTConnection />;
  const id = provider.id;
  return <ApiKeyCard key={id} name={provider.name} saved={ai.savedProviders.includes(id)} disabled={disabled}
    onSave={key => ai.saveKey(id, key)} onRemove={() => void ai.removeKey(id)}>
    {id === 'openrouter' && <>
      <Button variant="secondary" isDisabled={disabled} onPress={() => void ai.connectOpenRouter()}>Connect with OpenRouter</Button>
      <AppText className="text-center text-xs text-muted">or paste an API key</AppText>
    </>}
  </ApiKeyCard>;
}

/** Models the credential can use, read live where possible; otherwise the documented ones. */
function ModelSection({ provider }: { provider: AiProvider }) {
  const ai = useAi();
  const disabled = useBusy();
  const list = ai.modelLists[provider.id];
  const selected = ai.selectedModels[provider.id];
  const checking = list?.status === 'checking';
  const models = list?.models.length ? list.models : provider.models;
  const shown = selected && !models.some(model => model.id === selected) ? [...models, { id: selected, label: selected, note: 'Not in the latest list' }] : models;
  const footer = checking ? `Checking with ${provider.name}…`
    : list?.status === 'rejected' ? `${provider.name} rejected this ${provider.id === 'chatgpt' ? 'account' : 'API key'}. Summaries will fail until it is fixed.`
    : list?.status === 'failed' ? `Couldn’t reach ${provider.name}. Showing its recommended models; refresh to try again.`
    : list?.status === 'ready' ? provider.id === 'openrouter' ? 'Models with at least 32k context. Requests only go to providers with zero data retention.'
      : `Models your ${provider.id === 'chatgpt' ? 'ChatGPT plan' : 'API key'} can use.`
    : undefined;
  return (
    <Section title="Model" footer={footer} action={checking ? <Spinner size="sm" />
      : <Button size="sm" variant="ghost" className="-mr-3" isDisabled={disabled} onPress={() => void ai.refreshModels(provider.id)}>Refresh</Button>}>
      <ChoiceList label="models" items={shown.map(model => ({ id: model.id, title: model.label, description: model.note }))}
        selected={selected} disabled={disabled} onSelect={id => void ai.selectModel(provider.id, id)} />
    </Section>
  );
}

/** Opt-in, per provider: each summary sends a transcript and may be billed, so turning it on is confirmed once. */
function AutoSummarize({ provider }: { provider: AiProvider }) {
  const ai = useAi();
  const { library } = usePocket();
  const transcription = useTranscription();
  const connected = useConnected(provider.id);
  const change = (enabled: boolean) => {
    if (!enabled) { void ai.setAutoSummarize(false); return; }
    const count = unsummarized(library, transcription.entries, ai.entries).length;
    Alert.alert(`Summarize automatically with ${provider.name}?`,
      `Open Pocket will send each finished transcript without a summary to ${provider.name}, one at a time while the app is open. ${provider.billing} ${count === 1 ? '1 transcript is' : `${count} transcripts are`} waiting now. Failed summaries are not retried automatically.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn on', onPress: () => void ai.setAutoSummarize(true) }]);
  };
  const status = !connected ? `Connect ${provider.name} first.`
    : ai.autoPaused ? 'Paused after a failed summary. It continues with the next recording when you reopen Open Pocket.'
    : ai.autoSummarize ? 'New transcripts get a title and summary while Open Pocket is open.' : undefined;
  return (
    <Section title="Automatic" footer={status}>
      <Card><Card.Body className="flex-row items-center gap-4">
        <View className="flex-1 gap-1">
          <Card.Title>Summarize automatically</Card.Title>
          <Card.Description>A title and summary for every transcript, using {provider.name}.</Card.Description>
        </View>
        <Switch accessibilityLabel="Summarize automatically" isSelected={ai.autoSummarize}
          isDisabled={useBusy() || !connected} onSelectedChange={change} />
      </Card.Body></Card>
    </Section>
  );
}

/** The Settings row; the provider controls live on their own page. */
export function AiRow() {
  const ai = useAi();
  const router = useRouter();
  const provider = getAiProvider(ai.selectedProvider);
  const connected = useConnected(provider.id);
  const model = useModelLabel(provider.id);
  return (
    <ListGroup.Item accessibilityRole="button" onPress={() => router.push('/settings/ai')}>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>AI</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>{ai.loading ? 'Loading…' : connected
          ? `${provider.name} · ${model}${ai.autoSummarize ? ' · Automatic' : ''}` : `${provider.name} · Not connected`}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix />
    </ListGroup.Item>
  );
}

/** The AI page: pick a provider, connect it, choose a model, and opt in to automatic summaries. */
export function AiSettings() {
  const ai = useAi();
  const provider = getAiProvider(ai.selectedProvider);
  const connected = useConnected(provider.id);
  const checked = Boolean(ai.modelLists[provider.id]);
  const { refreshModels } = ai;
  // Check the credential once per session when its provider is shown.
  useEffect(() => { if (connected && !checked) void refreshModels(provider.id); }, [connected, checked, provider.id, refreshModels]);
  return (
    <View className="gap-6">
      {ai.error && <ErrorRow message={ai.error} onDismiss={ai.clearError} />}
      {(ai.loading || ai.saving) && <View className="flex-row items-center gap-2" accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
        <Spinner size="sm" /><AppText className="text-sm text-muted">{ai.loading ? 'Loading…' : 'Saving…'}</AppText>
      </View>}
      {ai.active && <AppText className="text-sm text-muted">A summary is being written. Settings can change when it finishes.</AppText>}
      <Section title="Provider" footer="Only transcript text is sent, never audio.">
        <ProviderList />
      </Section>
      <Section title={provider.id === 'chatgpt' ? 'ChatGPT account' : `${provider.name} API key`}
        intro={`${provider.description} ${provider.billing}`}
        footer={provider.id === 'chatgpt' ? undefined : `Stored only on this iPhone. Removing it here does not revoke it at ${provider.name}.`}>
        <Credential provider={provider} />
      </Section>
      {connected && <ModelSection provider={provider} />}
      <AutoSummarize provider={provider} />
      <Section title={`${provider.name} links`}>
        <LinkRows name={provider.name} links={[
          ...provider.apiKeyUrl ? [{ label: 'Get an API key', icon: 'key-outline' as const, url: provider.apiKeyUrl }] : [],
          { label: 'Pricing', icon: 'pricetag-outline', url: provider.pricingUrl },
          { label: 'Privacy & data retention', icon: 'shield-checkmark-outline', url: provider.privacyUrl },
        ]} />
      </Section>
    </View>
  );
}
