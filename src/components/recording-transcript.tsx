import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Spinner, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { ActionButton } from '@/components/action-button';
import { AppText } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { useTranscription } from '@/contexts/transcription-context';
import { getTranscriptionProvider } from '@/lib/transcription/providers';
import { recordingKey, resumableJob } from '@/lib/transcription/state';
import type { LocalRecording } from '@/lib/pocket/types';

// Four preview lines (text-sm leading-6); longer transcripts fade out and offer "Show more".
const PREVIEW_LINES = 4;
const LINE_HEIGHT = 24;
const FADE_HEIGHT = 48;

/** Copies text to the clipboard; the state reads Copied (or failed) for two seconds. */
function useCopy(text: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try { await Clipboard.setStringAsync(text); setState('copied'); }
    catch { setState('failed'); }
  };
  return { state, copy: () => void copy() };
}

/** The card's copy icon; it turns into a checkmark (or alert) after copying. */
function CopyButton({ text }: { text: string }) {
  const { state, copy } = useCopy(text);
  const [foreground, success, danger] = useThemeColor(['foreground', 'success', 'danger']);
  return (
    <Button isIconOnly size="sm" variant="ghost" className="-my-2 -mr-2" accessibilityLiveRegion="polite"
      accessibilityLabel={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy transcript'}
      onPress={copy}>
      <Ionicons name={state === 'copied' ? 'checkmark' : state === 'failed' ? 'alert-circle-outline' : 'copy-outline'} size={20}
        color={state === 'copied' ? success : state === 'failed' ? danger : foreground} />
    </Button>
  );
}

/** The full transcript with Copy text as its primary action. */
function TranscriptSheet({ text, visible, onClose, children }: { text: string; visible: boolean; onClose(): void; children: React.ReactNode }) {
  const { state, copy } = useCopy(text);
  return <Sheet title="Transcript" visible={visible} onClose={onClose} scrollable
    primary={{ label: state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy text', onPress: copy }}>
    {children}
  </Sheet>;
}

/** The first lines of the transcript, fading into the card like HeroUI's scroll shadow when there is more. */
function Preview({ text, onMore }: { text: string; onMore(): void }) {
  const surface = useThemeColor('surface');
  const [overflows, setOverflows] = useState(false);
  // One block without the card's gap, so Show more sits right under the faded line.
  return <View>
    <View style={{ maxHeight: PREVIEW_LINES * LINE_HEIGHT, overflow: 'hidden' }}>
      {/* iOS reports only the lines that fit a clipped Text, so an unclipped invisible copy counts them. */}
      <AppText className="text-sm leading-6" style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 }}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        onTextLayout={event => setOverflows(event.nativeEvent.lines.length > PREVIEW_LINES)}>{text}</AppText>
      <AppText selectable className="text-sm leading-6">{text}</AppText>
      {overflows && <Svg pointerEvents="none" width="100%" height={FADE_HEIGHT} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Defs>
          <LinearGradient id="transcript-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={surface} stopOpacity={0} />
            <Stop offset="1" stopColor={surface} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#transcript-fade)" />
      </Svg>}
    </View>
    {overflows && <View className="-mb-4 items-center">
      {/* The ghost button's invisible padding would double the card's bottom padding. */}
      <Button size="sm" variant="ghost" onPress={onMore}>Show more</Button>
    </View>}
  </View>;
}

export function RecordingTranscript({ recording }: { recording: LocalRecording }) {
  const transcription = useTranscription();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const confirming = useRef(false);
  const key = recordingKey(recording);
  const entry = transcription.entries[key];
  const resume = resumableJob(entry);
  const active = transcription.active?.recordingKey === key ? transcription.active : null;
  const provider = getTranscriptionProvider(active?.provider ?? ((resume || entry?.status === 'complete') && entry
    ? entry.provider : transcription.selectedProvider));
  const disabled = transcription.loading || transcription.saving || Boolean(transcription.active);
  const saved = transcription.savedProviders.includes(provider.id);
  const text = entry?.status === 'complete' ? entry.text?.trim() ?? '' : '';

  const confirmTranscription = () => {
    if (disabled || !saved || confirming.current) return;
    confirming.current = true;
    const message = resume
      ? `Resume checking ${provider.name} for the existing transcription. Your audio was already uploaded; this does not create another transcription. Charges for the original job still apply. Keep OpenPocket open. Failed requests are not retried automatically.`
      : `This sends this recording’s audio to ${provider.name} for cloud transcription and bills your API account separately from ChatGPT. Keep OpenPocket open until it finishes. Failed requests are not retried automatically.${entry ? '\n\nA previous attempt may already have been billed. Retrying uploads the audio again and may incur another charge.' : ''}`;
    Alert.alert(resume ? `Resume ${provider.name} transcription?` : `Transcribe with ${provider.name}?`, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: resume ? 'Resume' : 'Upload & transcribe', onPress: () => {
        confirming.current = false;
        void transcription.start(recording, provider.id);
      } },
    ], { cancelable: true, onDismiss: () => { confirming.current = false; } });
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Card.Title className="flex-1">Transcript</Card.Title>
        {Boolean(text) && <CopyButton text={text} />}
      </View>
      {entry?.status === 'complete' ? <>
        {entry.unsaved && <View className="items-start gap-2">
          <AppText className="text-sm text-danger" accessibilityRole="alert">Not saved yet. Save or copy this transcript before closing the app.</AppText>
          <ActionButton icon="save-outline" label="Save transcript" isDisabled={disabled}
            onPress={() => void transcription.start(recording)} />
        </View>}
        {text ? <>
          <Preview text={text} onMore={() => setOpen(true)} />
          <TranscriptSheet text={text} visible={open} onClose={() => setOpen(false)}>
            <AppText className="text-xs text-muted">{provider.name}{entry.model ? ` · ${entry.model}` : ''}</AppText>
            <AppText selectable className="text-base leading-7">{text}</AppText>
          </TranscriptSheet>
        </> : <AppText className="text-sm text-muted">No speech was detected.</AppText>}
      </> : active ? <>
        <View className="flex-row items-center gap-2" accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
          <Spinner size="sm" /><AppText className="flex-1 text-sm text-muted">{active.stage} · {provider.name}</AppText>
        </View>
        <AppText className="text-xs leading-5 text-muted">Keep OpenPocket open. Cancelling stops waiting; the provider may still process and bill this request.</AppText>
        <View className="items-start"><ActionButton icon="close" label="Cancel transcription" onPress={transcription.cancel} /></View>
      </> : <>
        {entry?.status === 'pending' && <AppText className="text-sm text-muted">Transcription interrupted. {resume ? `Resume the existing ${provider.name} job without uploading again.` : 'You can try again; the previous attempt may already have been billed.'}</AppText>}
        {entry?.error && <AppText className="text-sm text-danger" accessibilityRole="alert">{entry.error}</AppText>}
        {saved ? <View className="items-start">
          <ActionButton icon={resume ? 'refresh' : 'document-text-outline'} isDisabled={disabled} onPress={confirmTranscription}
            label={resume ? `Resume with ${provider.name}` : entry ? `Retry with ${provider.name}` : `Transcribe with ${provider.name}`} />
        </View> : <>
          <AppText className="text-sm text-muted">Add a {provider.name} API key to {resume ? 'resume this transcription' : 'transcribe this recording'}.</AppText>
          <View className="items-start">
            <ActionButton icon="settings-outline" label="Transcription settings" isDisabled={transcription.loading}
              onPress={() => router.push('/settings/transcription')} />
          </View>
        </>}
      </>}
    </View>
  );
}
