import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { unsummarized } from '@/lib/ai/auto';
import { createAiController } from '@/lib/ai/controller';
import { discoverAiModels, summarizeTranscript } from '@/lib/ai/generate';
import { authorizeOpenRouter } from '@/lib/ai/openrouter-auth';
import { diagnostics, safeErrorMessage } from '@/lib/diagnostics';
import { AiError } from '@/lib/ai/request';
import { loadAiSettings, loadSummaries, saveAiSettings, saveSummaries } from '@/storage/ai';
import { useChatGPT } from './chatgpt-context';
import { usePocket } from './pocket-context';
import { useTranscription } from './transcription-context';

const fetcher = expoFetch as typeof fetch;

function createController(planToken: () => Promise<string | null>) {
  return createAiController({
    loadSettings: loadAiSettings, saveSettings: saveAiSettings,
    loadEntries: loadSummaries, saveEntries: saveSummaries,
    planToken, authorizeOpenRouter,
    summarize: (credential, model, transcript, signal) => summarizeTranscript(credential, model, transcript, fetcher, signal),
    listModels: (credential, signal) => discoverAiModels(credential, fetcher, signal),
    registerSecret: secret => diagnostics.registerSecret(secret),
    onError: (context, cause) => diagnostics.log('ai', `${context}: ${cause instanceof AiError && cause.detail
      ? `${cause.message} (${cause.detail})` : safeErrorMessage(cause)}`),
  });
}
type Controller = ReturnType<typeof createController>;
type State = ReturnType<Controller['snapshot']> & Pick<Controller, 'selectProvider' | 'saveKey' | 'removeKey'
  | 'connectOpenRouter' | 'selectModel' | 'refreshModels' | 'setAutoSummarize' | 'generate' | 'cancel' | 'clearError' | 'mergeSummary'>;
const AiContext = createContext<State | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const { planToken } = useChatGPT();
  const { library } = usePocket();
  const transcription = useTranscription();
  const [client] = useState(() => createController(planToken));
  const [state, setState] = useState(() => client.snapshot());
  useEffect(() => {
    const unsubscribe = client.subscribe(() => setState(client.snapshot()));
    void client.load();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background') client.cancel();
      // A failure paused automatic summaries; reopening the app tries the next recording.
      if (next === 'active') client.resumeAuto();
    });
    return () => { unsubscribe(); subscription.remove(); client.cancel(); };
  }, [client]);
  const candidates = useMemo(() => state.autoSummarize ? unsummarized(library, transcription.entries, state.entries) : [],
    [state.autoSummarize, library, transcription.entries, state.entries]);
  // Settle briefly after transcripts change before sending anything.
  useEffect(() => {
    if (!candidates.length || state.autoPaused || state.active || state.loading) return;
    const timer = setTimeout(() => void client.autoSummarize(candidates), 3000);
    return () => clearTimeout(timer);
  }, [client, candidates, state.autoPaused, state.active, state.loading]);
  return <AiContext.Provider value={{ ...state, selectProvider: client.selectProvider, saveKey: client.saveKey,
    removeKey: client.removeKey, connectOpenRouter: client.connectOpenRouter, selectModel: client.selectModel,
    refreshModels: client.refreshModels, setAutoSummarize: client.setAutoSummarize, generate: client.generate,
    cancel: client.cancel, clearError: client.clearError, mergeSummary: client.mergeSummary }}>
    {children}
  </AiContext.Provider>;
}

export function useAi() {
  const context = useContext(AiContext);
  if (!context) throw new Error('AiProvider is missing.');
  return context;
}
