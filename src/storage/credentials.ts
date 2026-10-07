import * as SecureStore from 'expo-secure-store';
import type { PocketDevice } from '@/lib/pocket/types';

export interface SavedConnection {
  key: string;
  device: PocketDevice;
  source: string;
}

const STORE_KEY = 'openpocket.verified-connection.v1';

export async function loadConnection(): Promise<SavedConnection | null> {
  const value = await SecureStore.getItemAsync(STORE_KEY);
  if (!value) return null;
  try {
    const saved = JSON.parse(value) as SavedConnection;
    if (typeof saved.key !== 'string' || saved.key.length !== 16 || typeof saved.device?.id !== 'string') return null;
    return saved;
  } catch { return null; }
}

export async function saveConnection(value: SavedConnection): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function forgetConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
}
