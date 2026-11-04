import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type WifiTransferResult = { bytesWritten: number; uri: string };
export type WifiTransferProgress = { bytesWritten: number };
export type VerifiedChatGPTIdentity = { subject: string; email: string | null };
type EventSubscription = { remove(): void };

type PocketWifiNative = {
  join(ssid: string, password: string): Promise<void>;
  openTransfer(destinationUri: string): Promise<void>;
  completeTransfer(expectedBytes: number): Promise<WifiTransferResult>;
  cancel(): Promise<void>;
  leave(ssid: string): Promise<void>;
  startOAuthLoopback(): Promise<number>;
  stopOAuthLoopback(): Promise<void>;
  verifyChatGPTIdentity(
    idToken: string,
    jwksJson: string,
    clientId: string,
    nonce: string,
  ): Promise<VerifiedChatGPTIdentity>;
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

/** One-shot 127.0.0.1 relay that forwards Pocket's sign-in redirect to the app scheme. */
export const PocketOAuthLoopback = {
  start: async () => {
    if (Platform.OS !== 'ios' || !native) {
      throw new Error('Pocket sign-in needs the OpenPocket iPhone development build. Use an API key instead.');
    }
    return native.startOAuthLoopback();
  },
  stop: async () => { await native?.stopOAuthLoopback(); },
};

export const ChatGPTIdentity = {
  verify: async (idToken: string, jwksJson: string, clientId: string, nonce: string) => {
    if (Platform.OS !== 'ios' || !native || !native.verifyChatGPTIdentity) {
      throw new Error('ChatGPT sign-in needs the latest OpenPocket iPhone development build.');
    }
    return native.verifyChatGPTIdentity(idToken, jwksJson, clientId, nonce);
  },
};

export default PocketWifi;
