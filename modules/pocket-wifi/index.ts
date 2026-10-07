import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type WifiTransferResult = { bytesWritten: number; uri: string };
export type WifiTransferProgress = { bytesWritten: number };
type EventSubscription = { remove(): void };

type PocketWifiNative = {
  join(ssid: string, password: string): Promise<void>;
  openTransfer(destinationUri: string): Promise<void>;
  completeTransfer(expectedBytes: number): Promise<WifiTransferResult>;
  cancel(): Promise<void>;
  leave(ssid: string): Promise<void>;
  addListener(
    name: 'transferProgress',
    listener: (event: WifiTransferProgress) => void,
  ): EventSubscription;
};

const native = requireOptionalNativeModule<PocketWifiNative>('PocketWifi');

function requireNative(): PocketWifiNative {
  if (Platform.OS !== 'ios' || !native) {
    throw new Error(
      'Wi-Fi transfer needs the OpenPocket iPhone development build. It is unavailable in Expo Go and on other platforms.',
    );
  }
  return native;
}

const PocketWifi = {
  isAvailable: () => Platform.OS === 'ios' && native !== null,
  join: async (ssid: string, password: string) => requireNative().join(ssid, password),
  openTransfer: async (destinationUri: string) => requireNative().openTransfer(destinationUri),
  completeTransfer: async (expectedBytes: number) => requireNative().completeTransfer(expectedBytes),
  cancel: async () => requireNative().cancel(),
  leave: async (ssid: string) => requireNative().leave(ssid),
  addListener: (name: 'transferProgress', listener: (event: WifiTransferProgress) => void) =>
    requireNative().addListener(name, listener),
};

export default PocketWifi;
