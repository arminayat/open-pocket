import * as SecureStore from 'expo-secure-store';
import { parseStore } from '@/lib/chatgpt/helpers';
import type { ChatGPTStore } from '@/lib/chatgpt/types';

const STORE_KEY = 'openpocket.chatgpt.v1';
export async function loadChatGPTAccounts(): Promise<ChatGPTStore | null> {
  const value = await SecureStore.getItemAsync(STORE_KEY);
  return value ? parseStore(value) : null;
}
export async function saveChatGPTAccounts(store: ChatGPTStore): Promise<void> {
  // One Keychain replacement keeps issued IDs and rotating credentials together.
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(store), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
