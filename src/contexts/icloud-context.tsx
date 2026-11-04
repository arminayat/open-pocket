import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { getICloudStatus, requireICloudNative } from '../../modules/pocket-icloud';
import { usePocket } from './pocket-context';
import { useTranscription } from './transcription-context';
import { useAi } from './ai-context';
import { useNotes } from './notes-context';
import { createICloudController } from '@/lib/icloud/controller';
import { diagnostics, safeErrorMessage } from '@/lib/diagnostics';
import { summaryEntry } from '@/lib/icloud/archive';
import { syncICloud } from '@/lib/icloud/engine';
import { recordingKey } from '@/lib/transcription/state';
import { loadICloudPreference, saveICloudPreference } from '@/storage/icloud';

type Controller = ReturnType<typeof createICloudController>;
type State = ReturnType<Controller['snapshot']> & Pick<Controller, 'setEnabled' | 'sync'>;
const ICloudContext = createContext<State | null>(null);

type Sources = { pocket: ReturnType<typeof usePocket>; transcription: ReturnType<typeof useTranscription>; notes: ReturnType<typeof useNotes>;
  ai: ReturnType<typeof useAi> };

function createController(initial: Sources) {
  let sources = initial;
  const audioHashes = new Map<string, string>();
  const client = createICloudController({
    loadPreference: loadICloudPreference, savePreference: saveICloudPreference,
    status: getICloudStatus,
    open: account => requireICloudNative().open(account),
    close: () => { try { requireICloudNative().close(); } catch { /* Older builds have no session. */ } },
    reconcile: async (session, checkActive, onStage) => {
      const current = sources;
      if (current.pocket.busy === 'loading' || current.transcription.loading || current.notes.loading || current.ai.loading) {
        return { pending: 1, errors: 0, conflicts: 0, published: 0, imported: 0, uploaded: 0 };
      }
      const materials = current.pocket.library.map(recording => ({
        recording, transcript: current.transcription.entries[recordingKey(recording)],
        note: current.notes.entries[recordingKey(recording)],
        summary: current.ai.entries[recordingKey(recording)],
      }));
      const expected = new Map(materials.map(item => [recordingKey(item.recording), item]));
      return syncICloud({
        session, materials, audioHashes, checkActive, onStage, transport: requireICloudNative(),
        onError: (context, cause) => diagnostics.log('icloud', `${context}: ${safeErrorMessage(cause)}`),
        sha256: text => digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
        importRecording: current.pocket.adoptCloudRecording,
        mergeTranscript: (recording, artifact) => current.transcription.mergeTranscript(
          recording, artifact, expected.get(recordingKey(recording))?.transcript ?? null),
        mergeSummary: (recording, artifact) => {
          const key = recordingKey(recording);
          return current.ai.mergeSummary(recording, summaryEntry(key, artifact), expected.get(key)?.summary ?? null);
        },
        mergeNote: (recording, artifact) => {
          const key = recordingKey(recording);
          return current.notes.merge([{ recordingKey: key, text: artifact.text,
            updatedAt: artifact.updatedAt, revision: artifact.revision }],
          { [key]: expected.get(key)?.note?.revision ?? null });
        },
      });
    },
  });
  return { client, updateSources(next: Sources) { sources = next; } };
}

export function ICloudProvider({ children }: { children: React.ReactNode }) {
  const pocket = usePocket();
  const transcription = useTranscription();
  const notes = useNotes();
  const ai = useAi();
  const [{ client, updateSources }] = useState(() => createController({ pocket, transcription, notes, ai }));
  useEffect(() => { updateSources({ pocket, transcription, notes, ai }); }, [updateSources, pocket, transcription, notes, ai]);
  const [state, setState] = useState(() => client.snapshot());
  // Only durable source versions trigger a run. Status updates must not cause a sync loop.
  const versions = JSON.stringify([
    pocket.library.map(recordingKey),
    Object.values(transcription.entries).map(entry => [entry.recordingKey, entry.status, entry.updatedAt, entry.unsaved]),
    Object.values(notes.entries).map(entry => [entry.recordingKey, entry.revision]),
    Object.values(ai.entries).map(entry => [entry.recordingKey, entry.updatedAt]),
    pocket.busy === 'loading', transcription.loading, notes.loading, ai.loading,
  ]);
  useEffect(() => {
    client.setForeground(AppState.currentState === 'active');
    const unsubscribe = client.subscribe(() => setState(client.snapshot()));
    void client.load().then(() => client.sync());
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => void client.sync(), 800); };
    let nativeSubscription: { remove(): void } | undefined;
    try { nativeSubscription = requireICloudNative().addListener('change', schedule); } catch { /* Show build requirement in Settings. */ }
    const appSubscription = AppState.addEventListener('change', next => {
      client.setForeground(next === 'active');
      if (next === 'active') schedule();
    });
    const timer = setInterval(() => void client.sync(), 25_000);
    return () => {
      unsubscribe(); appSubscription.remove(); nativeSubscription?.remove();
      clearInterval(timer); clearTimeout(debounce); client.close();
    };
  }, [client]);
  useEffect(() => {
    const timer = setTimeout(() => void client.sync(), 800);
    return () => clearTimeout(timer);
  }, [client, versions, state.enabled, state.saving]);
  return <ICloudContext.Provider value={{ ...state, setEnabled: client.setEnabled, sync: client.sync }}>
    {children}
  </ICloudContext.Provider>;
}

export function useICloud() {
  const value = useContext(ICloudContext);
  if (!value) throw new Error('ICloudProvider is missing.');
  return value;
}
