import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type ICloudStatus = { available: boolean; accountId: string | null; reason: string };
export type ICloudFile = { path: string; downloaded: boolean; uploaded: boolean; conflict: boolean };
export type ICloudScan = { gathering: boolean; files: ICloudFile[]; errors: number };

export type NativeICloud = {
  status(): Promise<ICloudStatus>;
  open(accountId: string): Promise<string>;
  close(): void;
  identify(uri: string, expectedBytes: number): Promise<string>;
  scan(session: string): Promise<ICloudScan>;
  putAudio(session: string, folder: string, uri: string, expectedBytes: number, sha256: string): Promise<void>;
  putText(session: string, path: string, text: string): Promise<void>;
  readText(session: string, path: string): Promise<string | null>;
  downloadAudio(session: string, path: string, bytes: number, sha256: string): Promise<string | null>;
  moveFolder(session: string, from: string, to: string, sha256: string): Promise<void>;
  addListener(event: 'change', listener: () => void): { remove(): void };
};

const native = requireOptionalNativeModule<NativeICloud & { reserve(account: string): string }>('PocketICloud');

export function requireICloudNative(): NativeICloud {
  if (Platform.OS !== 'ios' || !native) {
    throw new Error('iCloud sync needs the latest OpenPocket iPhone development build.');
  }
  return {
    status: () => native.status(),
    open: accountId => native.open(native.reserve(accountId)),
    close: () => native.close(),
    identify: (...args) => native.identify(...args),
    scan: session => native.scan(session),
    putAudio: (...args) => native.putAudio(...args),
    putText: (...args) => native.putText(...args),
    readText: (...args) => native.readText(...args),
    downloadAudio: (...args) => native.downloadAudio(...args),
    moveFolder: (...args) => native.moveFolder(...args),
    addListener: (...args) => native.addListener(...args),
  };
}

export function getICloudStatus(): Promise<ICloudStatus> {
  if (Platform.OS !== 'ios' || !native) {
    return Promise.resolve({ available: false, accountId: null,
      reason: 'iCloud sync needs the latest OpenPocket iPhone development build.' });
  }
  return native.status();
}
