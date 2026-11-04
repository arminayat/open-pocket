import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, Spinner } from 'heroui-native';
import { useChatGPT } from '@/contexts/chatgpt-context';
import { usePocket } from '@/contexts/pocket-context';
import { LearnMore } from '@/components/learn-more';
import { SheetLead, SheetPoint } from '@/components/sheet';
import { AppText } from '@/components/screen';

export function ChatGPTConnection({ optional = false }: { optional?: boolean }) {
  const chatgpt = useChatGPT();
  const pocket = usePocket();
  const [linkError, setLinkError] = useState<string | null>(null);
  const disabled = chatgpt.loading || chatgpt.busy || Boolean(pocket.busy);
  const error = chatgpt.error ?? linkError;

  const openUsage = async () => {
    setLinkError(null);
    try {
      await Linking.openURL('https://chatgpt.com/settings/usage');
    } catch {
      setLinkError('Could not open ChatGPT usage settings. Please try again.');
    }
  };

  return (
    <Card>
      <Card.Body className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Card.Title className="flex-1">{optional ? 'ChatGPT (optional)' : 'ChatGPT'}</Card.Title>
          <LearnMore title="ChatGPT">
            <SheetLead>Titles and summaries from your ChatGPT plan, no API key needed.</SheetLead>
            <View className="gap-3 pt-1">
              <SheetPoint icon="document-text-outline">Only transcript text is sent, never audio.</SheetPoint>
              <SheetPoint icon="speedometer-outline">Counts toward your plan’s limits for other apps.</SheetPoint>
              <SheetPoint icon="mic-outline">Transcription uses its own API key.</SheetPoint>
            </View>
          </LearnMore>
        </View>

        {chatgpt.profiles.map(profile => {
          const status = !profile.signedIn ? 'Signed out'
            : profile.needsReconnect ? 'Connection expired'
            : !profile.planEnabled ? 'Plan access disabled'
            : profile.active ? 'Active account' : 'Connected';
          const action = !profile.signedIn || profile.needsReconnect ? 'Reconnect'
            : !profile.planEnabled ? 'Enable plan access' : 'Use account';
          const canConnect = !profile.signedIn || profile.needsReconnect || !profile.planEnabled || !profile.active;
          return (
            <View key={profile.clientId} className="gap-3 rounded-xl bg-surface-secondary p-3">
              <View className="gap-1">
                <AppText>{profile.label}</AppText>
                <AppText className="text-xs text-muted">{status}</AppText>
              </View>
              {(canConnect || profile.signedIn) && <View className="flex-row flex-wrap gap-2">
                {canConnect && <Button size="sm" variant="secondary" isDisabled={disabled}
                  accessibilityLabel={`${action}: ${profile.label}`}
                  onPress={() => void chatgpt.connect(profile.clientId)}>{action}</Button>}
                {profile.signedIn && <Button size="sm" variant="ghost" isDisabled={disabled}
                  accessibilityLabel={`Sign out of ${profile.label}`}
                  onPress={() => void chatgpt.signOut(profile.clientId)}>Sign out</Button>}
              </View>}
            </View>
          );
        })}

        <View className="gap-2">
          {chatgpt.profiles.length > 0 && <AppText className="text-xs text-muted">Add another ChatGPT account</AppText>}
          <Button variant="secondary" isDisabled={disabled} onPress={() => void chatgpt.connect()}>
            Continue with ChatGPT
          </Button>
        </View>
        {chatgpt.profiles.length > 0 && <Button size="sm" variant="ghost" isDisabled={chatgpt.loading || chatgpt.busy}
          onPress={() => void openUsage()}>Manage ChatGPT usage</Button>}

        {(chatgpt.loading || chatgpt.busy) && <View className="flex-row items-center gap-3"
          accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
          <Spinner size="sm" />
          <AppText className="text-sm text-muted">{chatgpt.loading ? 'Loading ChatGPT accounts…' : 'Updating ChatGPT connection…'}</AppText>
        </View>}
        {chatgpt.notice && <AppText className="text-sm text-muted" accessibilityLiveRegion="polite">{chatgpt.notice}</AppText>}
        {error && <View className="gap-2">
          <AppText className="text-sm text-danger" accessibilityRole="alert">{error}</AppText>
          <Button size="sm" variant="ghost" accessibilityLabel="Dismiss ChatGPT error"
            onPress={() => { setLinkError(null); chatgpt.clearError(); }}>Dismiss</Button>
        </View>}
      </Card.Body>
    </Card>
  );
}
