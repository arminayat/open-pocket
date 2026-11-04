import * as SecureStore from 'expo-secure-store';
import type { PocketDevice } from '@/lib/pocket/types';

export interface SavedConnection {
  key: string;
  device: PocketDevice;
  source: string;
}

/** Signed-in or imported key that no recorder has accepted yet. */
export interface PendingCredential {
  key: string;
  source: string;
  accountLabel: string;
}

const STORE_KEY = 'openpocket.verified-connection.v1';
const PENDING_KEY = 'openpocket.pending-credential.v1';
const keychainOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

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
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(value), keychainOptions);
  // A verified connection supersedes the unverified candidate.
  await SecureStore.deleteItemAsync(PENDING_KEY);
}

export async function loadPendingCredential(): Promise<PendingCredential | null> {
  const value = await SecureStore.getItemAsync(PENDING_KEY);
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as PendingCredential;
    if (typeof pending.key !== 'string' || pending.key.length !== 16 || typeof pending.source !== 'string' ||
        typeof pending.accountLabel !== 'string') return null;
    return pending;
  } catch { return null; }
}

export async function savePendingCredential(value: PendingCredential): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(value), keychainOptions);
}

export async function forgetConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
  await SecureStore.deleteItemAsync(PENDING_KEY);
}
