import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { signInToPocket, connectWithApiKey, validateDeviceKey } from '@/lib/account';
import { diagnostics, safeErrorMessage } from '@/lib/diagnostics';
import { createPocketClient, PocketError } from '@/lib/pocket';
import { AUTO_RECONNECT_RETRY_MS, autoReconnectDue, nextAutoDownload } from '@/lib/pocket/auto-download';
import type { RecordingManifest } from '@/lib/icloud/types';
import type { DeviceInfo, DownloadProgress, LocalRecording, PocketDevice, Recording, Transport } from '@/lib/pocket/types';
import {
  forgetConnection, loadConnection, loadPendingCredential, saveConnection, savePendingCredential, type SavedConnection,
} from '@/storage/credentials';
import { adoptCloudRecording as adoptCloudRecordingInStorage, createDownloadTarget, loadLibrary } from '@/storage/library';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/storage/settings';

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
  autoDownload: boolean;
  setAutoDownload(value: boolean): void;
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
  adoptCloudRecording(manifest: RecordingManifest, uri: string): Promise<LocalRecording>;
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
  const initialLibrary = useRef<Promise<LocalRecording[]> | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const activeTransport = useRef<Transport | null>(null);
  /** Recordings whose automatic download failed or was cancelled; cleared on each new connection. */
  const autoSkipped = useRef(new Set<string>());
  const lastAutoReconnect = useRef<number | null>(null);
  /** A manual Disconnect pauses automatic reconnects until the user connects again. */
  const userDisconnected = useRef(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
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
    initialLibrary.current = loadLibrary().then(files => {
      if (mounted.current) setLibrary(files);
      return files;
    });
    void Promise.all([loadConnection(), loadPendingCredential(), initialLibrary.current, loadSettings().catch(() => DEFAULT_SETTINGS)]).then(([connection, pending, _files, stored]) => {
      if (!mounted.current) return;
      setSettings(stored);
      if (connection) {
        setSaved(connection);
        rememberCredential({ key: connection.key, source: connection.source, accountLabel: 'Saved Pocket connection' });
      } else if (pending) rememberCredential(pending);
    }).catch(() => {
      if (mounted.current) setError('Saved connection could not be loaded. Try connecting again.');
    }).finally(() => {
      locked.current = false;
      if (mounted.current) setBusy(null);
    });
    const remove = client.onDisconnect(() => {
      lastAutoReconnect.current = null;
      if (mounted.current) { setDevice(null); setInfo(null); setRecordings([]); }
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') lastAutoReconnect.current = null;
      setAppActive(state === 'active');
      // Bluetooth downloads continue in the background; Wi-Fi needs the app open to hold the hotspot.
      if (state === 'background' && activeTransport.current === 'wifi') {
        void client.cancel().catch(() => {});
        diagnostics.log('transfer', 'Wi-Fi download stopped because the app moved to the background.');
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

  /** New candidate keys survive app restarts until a recorder verifies or the user forgets them. */
  const adoptCredential = async (value: Credential) => {
    await savePendingCredential({ key: value.key, source: value.source, accountLabel: value.accountLabel });
    rememberCredential(value);
  };

  const clearError = useCallback(() => setError(null), []);

  /** Quiet runs are automatic work: failures are logged, never shown as an alert. */
  const run = useCallback(async (stage: string, work: () => Promise<void>, quiet = false) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(stage);
    if (!quiet) setError(null);
    diagnostics.log(stage, 'Started.');
    try { await work(); }
    catch (cause) {
      const message = safeErrorMessage(cause);
      if (mounted.current && !quiet) setError(cause instanceof PocketError && cause.code === 'cancelled' ? null : message);
      diagnostics.log(stage, message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(null);
    }
  }, []);

  const connectDevice = async (next: PocketDevice, current = credential) => {
    if (!current) throw new Error('Sign in to Pocket or enter your device key first.');
    autoSkipped.current.clear();
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

  const reconnectSaved = async () => {
    if (!saved) throw new Error('No verified recorder has been saved yet.');
    const verifiedCredential = { key: saved.key, source: saved.source, accountLabel: 'Saved Pocket connection' };
    rememberCredential(verifiedCredential);
    await connectDevice(saved.device, verifiedCredential);
  };

  const downloadRecording = async (recording: Recording, transport: Transport) => {
    const foreground = AppState.currentState !== 'background';
    if (transport === 'wifi' && !foreground) throw new Error('Keep OpenPocket open to start a Wi-Fi download.');
    activeTransport.current = transport;
    let target: ReturnType<typeof createDownloadTarget> | null = null;
    try {
      if (foreground) await activateKeepAwakeAsync('openpocket-transfer').catch(() => {});
      if (!mounted.current) throw new Error('OpenPocket closed before the download started.');
      target = createDownloadTarget(recording, transport);
      setProgress({ recordingId: recording.id, transport, stage: 'Preparing download', receivedBytes: 0, expectedBytes: 0 });
      const local = await client.download(recording, transport, target, setProgress);
      if (mounted.current) setLibrary(previous => [local, ...previous.filter(item => item.id !== local.id || item.transport !== local.transport)]);
      diagnostics.log('download', 'Recording saved.', { transport, bytes: local.bytes });
    } catch (cause) {
      try { target?.abort(); } catch { /* preserve original failure */ }
      throw cause;
    } finally {
      activeTransport.current = null;
      deactivateKeepAwake('openpocket-transfer');
      if (mounted.current) setProgress(null);
    }
  };

  // Automatic download: while the app is open, reconnect the saved recorder (at once on launch,
  // foreground, or link loss, then every 30 seconds until it answers), fetch every recording that
  // has no local copy over Bluetooth (newest first), and look for new ones every 2 minutes.
  const autoReconnect = useEffectEvent(() => {
    if (busy || !appActive || !settings.autoDownload || !saved || device || userDisconnected.current) return;
    const now = Date.now();
    if (!autoReconnectDue(lastAutoReconnect.current, now)) return;
    lastAutoReconnect.current = now;
    void run('connect', reconnectSaved, true);
  });
  const autoDownloadNext = useEffectEvent(() => {
    if (busy || !settings.autoDownload || !device) return;
    const next = nextAutoDownload(recordings, library, autoSkipped.current);
    if (!next) return;
    void run('sync', async () => {
      try { await downloadRecording(next, 'bluetooth'); }
      catch (cause) { autoSkipped.current.add(next.id); throw cause; }
    }, true);
  });
  const autoRefresh = useEffectEvent(() => {
    if (!busy && settings.autoDownload && device) void run('listing', async () => setRecordings(await client.listRecordings()), true);
  });
  useEffect(() => { autoReconnect(); }, [appActive, busy, saved, device, settings.autoDownload]);
  useEffect(() => {
    if (!appActive || !settings.autoDownload || !saved || device) return;
    const timer = setInterval(() => autoReconnect(), AUTO_RECONNECT_RETRY_MS);
    return () => clearInterval(timer);
  }, [appActive, device, saved, settings.autoDownload]);
  useEffect(() => { autoDownloadNext(); }, [busy, device, recordings, library, settings.autoDownload]);
  useEffect(() => {
    if (!settings.autoDownload || !device) return;
    const timer = setInterval(() => autoRefresh(), 120_000);
    return () => clearInterval(timer);
  }, [device, settings.autoDownload]);

  const setAutoDownload = (autoDownload: boolean) => {
    const next = { ...settings, autoDownload };
    setSettings(next);
    try { saveSettings(next); } catch { setError('The setting could not be saved. Try again.'); }
  };

  const adoptCloudRecording = useCallback(async (manifest: RecordingManifest, uri: string) => {
    if (!initialLibrary.current) throw new Error('The recording library is still loading. Try syncing again.');
    await initialLibrary.current;
    const local = await adoptCloudRecordingInStorage(manifest, uri);
    if (mounted.current) setLibrary(previous => [local, ...previous.filter(item => item.uri !== local.uri || item.id !== local.id)]);
    return local;
  }, []);

  const value: PocketState = {
    busy, error, credential, saved, nearby, device, info, recordings, library, progress,
    autoDownload: settings.autoDownload, setAutoDownload,
    clearError, adoptCloudRecording,
    signIn: () => run('sign-in', async () => adoptCredential(await signInToPocket())),
    importApiKey: value => run('account', async () => adoptCredential(await connectWithApiKey(value))),
    importDeviceKey: value => run('credential', async () => adoptCredential({ key: validateDeviceKey(value), source: 'device-key', accountLabel: 'Imported device key' })),
    scan: () => run('scan', async () => {
      setNearby([]);
      await client.scan(found => setNearby(previous => [...previous.filter(item => item.id !== found.id), found].sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100))));
    }),
    stopScan: () => client.stopScan(),
    connect: next => { userDisconnected.current = false; return run('connect', () => connectDevice(next)); },
    reconnect: () => { userDisconnected.current = false; return run('connect', reconnectSaved); },
    disconnect: () => run('disconnect', async () => {
      userDisconnected.current = true;
      await client.disconnect(); setDevice(null); setInfo(null); setRecordings([]);
    }),
    forget: () => run('forget', async () => {
      userDisconnected.current = false;
      await client.disconnect(); await forgetConnection();
      forgetCredentialSecrets.current.forEach(cleanup => cleanup());
      forgetCredentialSecrets.current = [];
      setDevice(null); setInfo(null); setCredential(null); setSaved(null); setNearby([]); setRecordings([]);
    }),
    refresh: () => run('listing', async () => setRecordings(await client.listRecordings())),
    download: (recording, transport) => run('download', () => downloadRecording(recording, transport)),
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
