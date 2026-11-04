import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { createTranscriptionController } from '@/lib/transcription/controller';
import { transcribe } from '@/lib/transcription/engine';
import { discoverModels } from '@/lib/transcription/models';
import { transcriptionTransport } from '@/lib/transcription/transport';
import { diagnostics } from '@/lib/diagnostics';
import { usePocket } from './pocket-context';
import { checkTranscriptionRecording, loadTranscriptionCredentials, loadTranscripts, saveTranscriptionCredentials, saveTranscripts } from '@/storage/transcription';

function createController() {
  return createTranscriptionController({
    loadCredentials: loadTranscriptionCredentials, saveCredentials: saveTranscriptionCredentials,
    loadEntries: loadTranscripts, saveEntries: saveTranscripts,
    checkRecording: checkTranscriptionRecording,
    transcribe: options => transcribe(options, transcriptionTransport),
    listModels: (provider, key, signal) => discoverModels(provider, key, transcriptionTransport.fetch, signal),
    registerSecret: key => diagnostics.registerSecret(key),
  });
}
type Controller = ReturnType<typeof createController>;
type State = ReturnType<Controller['snapshot']> & Pick<Controller, 'selectProvider' | 'saveKey' | 'removeKey' | 'selectModel' | 'refreshModels' | 'setAutoTranscribe' | 'start' | 'cancel' | 'clearError' | 'mergeTranscript'>;
const TranscriptionContext = createContext<State | null>(null);

function KeepTranscriptionAwake() { useKeepAwake('transcription'); return null; }

export function TranscriptionProvider({ children }: { children: React.ReactNode }) {
  const { library } = usePocket();
  const [client] = useState(createController);
  const [state, setState] = useState(() => client.snapshot());
  useEffect(() => {
    const unsubscribe = client.subscribe(() => setState(client.snapshot()));
    void client.load();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background') client.cancel();
      // A failure paused automatic transcription; reopening the app tries the next recording.
      if (next === 'active') client.resumeAuto();
    });
    return () => { unsubscribe(); subscription.remove(); client.cancel(); };
  }, [client]);
  // Settle briefly after library or transcript changes (downloads, iCloud merges) before uploading anything.
  useEffect(() => {
    if (!state.autoTranscribe || state.autoPaused || state.active || state.loading) return;
    const timer = setTimeout(() => void client.autoTranscribe(library), 3000);
    return () => clearTimeout(timer);
  }, [client, library, state.autoTranscribe, state.autoPaused, state.active, state.loading, state.entries]);
  return <TranscriptionContext.Provider value={{ ...state, selectProvider: client.selectProvider,
    saveKey: client.saveKey, removeKey: client.removeKey, selectModel: client.selectModel, refreshModels: client.refreshModels, setAutoTranscribe: client.setAutoTranscribe, start: client.start, cancel: client.cancel, clearError: client.clearError,
    mergeTranscript: client.mergeTranscript }}>
    {state.active && <KeepTranscriptionAwake />}
    {children}
  </TranscriptionContext.Provider>;
}

export function useTranscription() {
  const context = useContext(TranscriptionContext);
  if (!context) throw new Error('TranscriptionProvider is missing.');
  return context;
}
