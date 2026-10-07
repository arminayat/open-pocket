import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { signInToPocket, connectWithApiKey, validateDeviceKey } from '@/lib/account';
import { diagnostics, safeErrorMessage } from '@/lib/diagnostics';
import { createPocketClient, PocketError } from '@/lib/pocket';
import type { DeviceInfo, DownloadProgress, LocalRecording, PocketDevice, Recording, Transport } from '@/lib/pocket/types';
import { forgetConnection, loadConnection, saveConnection, type SavedConnection } from '@/storage/credentials';
import { createDownloadTarget, loadLibrary } from '@/storage/library';

interface Credential { key: string; source: string; accountLabel: string }
interface PocketState {
  busy: string | null;
  error: string | null;
  credential: Credential | null;
  saved: SavedConnection | null;
  nearby: PocketDevice[];
  device: PocketDevice | null;
  info: DeviceInfo | null;
  recordings: Recording[];
  library: LocalRecording[];
  progress: DownloadProgress | null;
  signIn(): Promise<void>;
  importApiKey(value: string): Promise<void>;
  importDeviceKey(value: string): Promise<void>;
  scan(): Promise<void>;
  stopScan(): void;
  connect(device: PocketDevice): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  forget(): Promise<void>;
  refresh(): Promise<void>;
  download(recording: Recording, transport: Transport): Promise<void>;
  cancel(): Promise<void>;
  clearError(): void;
}

const PocketContext = createContext<PocketState | null>(null);

export function PocketProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createPocketClient(diagnostics.log));
  const [busy, setBusy] = useState<string | null>('loading');
  const locked = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [nearby, setNearby] = useState<PocketDevice[]>([]);
  const [device, setDevice] = useState<PocketDevice | null>(null);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [library, setLibrary] = useState<LocalRecording[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const transferActive = useRef(false);
  const mounted = useRef(true);
  const forgetCredentialSecrets = useRef<(() => void)[]>([]);

  const rememberCredential = useCallback((value: Credential) => {
    if (!mounted.current) return;
    forgetCredentialSecrets.current.forEach(cleanup => cleanup());
    forgetCredentialSecrets.current = [diagnostics.registerSecret(value.key), diagnostics.registerSecret(value.key.slice(0, 8))];
    if (value.accountLabel) forgetCredentialSecrets.current.push(diagnostics.registerSecret(value.accountLabel));
    setCredential(value);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void Promise.all([loadConnection(), loadLibrary()]).then(([connection, files]) => {
      if (!mounted.current) return;
      setLibrary(files);
      if (connection) {
        setSaved(connection);
        rememberCredential({ key: connection.key, source: connection.source, accountLabel: 'Saved Pocket connection' });
      }
    }).catch(() => {
      if (mounted.current) setError('Saved connection could not be loaded. Try connecting again.');
    }).finally(() => {
      locked.current = false;
      if (mounted.current) setBusy(null);
    });
    const remove = client.onDisconnect(() => {
      if (mounted.current) { setDevice(null); setInfo(null); setRecordings([]); }
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' && transferActive.current) {
        void client.cancel().catch(() => {});
        diagnostics.log('transfer', 'Download stopped because the app moved to the background.');
      }
    });
    return () => {
      mounted.current = false;
      forgetCredentialSecrets.current.forEach(cleanup => cleanup());
      remove(); subscription.remove();
      client.stopScan();
      void client.disconnect().catch(() => {});
    };
  }, [client, rememberCredential]);

  const run = useCallback(async (stage: string, work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(stage); setError(null);
    diagnostics.log(stage, 'Started.');
    try { await work(); }
    catch (cause) {
      const message = safeErrorMessage(cause);
      if (mounted.current) setError(cause instanceof PocketError && cause.code === 'cancelled' ? null : message);
      diagnostics.log(stage, message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(null);
    }
  }, []);

  const connectDevice = async (next: PocketDevice, current = credential) => {
    if (!current) throw new Error('Sign in to Pocket or enter your device key first.');
    setDevice(null); setInfo(null); setRecordings([]);
    diagnostics.registerSecret(next.id);
    diagnostics.registerSecret(next.name);
    const details = await client.connect(next, current.key);
    if (!mounted.current) { await client.disconnect(); return; }
    setDevice(next); setInfo(details);
    const verified = { key: current.key, source: current.source, device: next };
    await saveConnection(verified);
    if (!mounted.current) return;
    setSaved(verified);
    diagnostics.log('authentication', 'Recorder accepted the device key.', { source: current.source, firmware: details.firmware });
    const listing = await client.listRecordings();
    if (mounted.current) setRecordings(listing);
  };

  const value: PocketState = {
    busy, error, credential, saved, nearby, device, info, recordings, library, progress,
    clearError: () => setError(null),
    signIn: () => run('sign-in', async () => rememberCredential(await signInToPocket())),
    importApiKey: value => run('account', async () => rememberCredential(await connectWithApiKey(value))),
    importDeviceKey: value => run('credential', async () => rememberCredential({ key: validateDeviceKey(value), source: 'device-key', accountLabel: 'Imported device key' })),
    scan: () => run('scan', async () => {
      setNearby([]);
      await client.scan(found => setNearby(previous => [...previous.filter(item => item.id !== found.id), found].sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100))));
    }),
    stopScan: () => client.stopScan(),
    connect: next => run('connect', () => connectDevice(next)),
    reconnect: () => run('connect', async () => {
      if (!saved) throw new Error('No verified recorder has been saved yet.');
      const verifiedCredential = { key: saved.key, source: saved.source, accountLabel: 'Saved Pocket connection' };
      rememberCredential(verifiedCredential);
      await connectDevice(saved.device, verifiedCredential);
    }),
    disconnect: () => run('disconnect', async () => { await client.disconnect(); setDevice(null); setInfo(null); setRecordings([]); }),
    forget: () => run('forget', async () => {
      await client.disconnect(); await forgetConnection();
      forgetCredentialSecrets.current.forEach(cleanup => cleanup());
      forgetCredentialSecrets.current = [];
      setDevice(null); setInfo(null); setCredential(null); setSaved(null); setNearby([]); setRecordings([]);
    }),
    refresh: () => run('listing', async () => setRecordings(await client.listRecordings())),
    download: (recording, transport) => run('download', async () => {
      transferActive.current = true;
      let target: ReturnType<typeof createDownloadTarget> | null = null;
      try {
        await activateKeepAwakeAsync('openpocket-transfer');
        if (!mounted.current || AppState.currentState === 'background') throw new Error('Keep OpenPocket open to start a download.');
        target = createDownloadTarget(recording, transport);
        setProgress({ recordingId: recording.id, transport, stage: 'Preparing download', receivedBytes: 0, expectedBytes: 0 });
        const local = await client.download(recording, transport, target, setProgress);
        if (mounted.current) setLibrary(previous => [local, ...previous.filter(item => item.id !== local.id || item.transport !== local.transport)]);
        diagnostics.log('download', 'Recording saved.', { transport, bytes: local.bytes });
      } catch (cause) {
        try { target?.abort(); } catch { /* preserve original failure */ }
        throw cause;
      } finally {
        transferActive.current = false;
        deactivateKeepAwake('openpocket-transfer');
        if (mounted.current) setProgress(null);
      }
    }),
    cancel: async () => {
      try { await client.cancel(); }
      catch (cause) { setError(safeErrorMessage(cause)); }
    },
  };
  return <PocketContext.Provider value={value}>{children}</PocketContext.Provider>;
}

export function usePocket() {
  const value = useContext(PocketContext);
  if (!value) throw new Error('PocketProvider is missing.');
  return value;
}
