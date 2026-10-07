export type Transport = 'bluetooth' | 'wifi';

export interface PocketDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export interface DeviceInfo {
  battery: number | null;
  firmware: string;
  wifiFirmware: string;
}

export interface Recording {
  id: string;
  date: string;
  timestamp: string;
  durationSeconds: number;
}

export interface LocalRecording extends Recording {
  uri: string;
  bytes: number;
  transport: Transport;
  downloadedAt: string;
}

export interface DownloadProgress {
  recordingId: string;
  transport: Transport;
  stage: string;
  receivedBytes: number;
  expectedBytes: number;
}

export interface DownloadTarget {
  uri: string;
  write(bytes: Uint8Array): void;
  commit(expectedBytes: number): Promise<LocalRecording>;
  abort(): void;
}

export type DiagnosticDetails = Record<string, string | number | boolean | null>;
export type DiagnosticLogger = (stage: string, message: string, details?: DiagnosticDetails) => void;

export interface PocketClient {
  scan(onDevice: (device: PocketDevice) => void): Promise<void>;
  stopScan(): void;
  connect(device: PocketDevice, key: string): Promise<DeviceInfo>;
  listRecordings(): Promise<Recording[]>;
  download(recording: Recording, transport: Transport, target: DownloadTarget,
    onProgress: (progress: DownloadProgress) => void): Promise<LocalRecording>;
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
  onDisconnect(callback: () => void): () => void;
}
