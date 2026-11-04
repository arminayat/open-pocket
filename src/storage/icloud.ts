import * as SecureStore from 'expo-secure-store';
import { ICLOUD_OFF, parseICloudPreference, type ICloudPreference } from '@/lib/icloud/controller';

const key = 'openpocket.icloud.preference.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function loadICloudPreference(): Promise<ICloudPreference> {
  const text = await SecureStore.getItemAsync(key, options);
  return text === null ? { ...ICLOUD_OFF } : parseICloudPreference(JSON.parse(text));
}

export async function saveICloudPreference(value: ICloudPreference): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(parseICloudPreference(value)), options);
}
