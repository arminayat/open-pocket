import { File, Paths } from 'expo-file-system';

export interface AppSettings {
  /** Download each recording found on the recorder over Bluetooth without user action. */
  autoDownload: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { autoDownload: true };
const settingsFile = () => new File(Paths.document, 'settings.json');

export function parseSettings(text: string): AppSettings {
  try {
    const value = JSON.parse(text) as Partial<AppSettings>;
    return { autoDownload: typeof value.autoDownload === 'boolean' ? value.autoDownload : DEFAULT_SETTINGS.autoDownload };
  } catch { return DEFAULT_SETTINGS; }
}

export async function loadSettings(): Promise<AppSettings> {
  const file = settingsFile();
  return file.exists ? parseSettings(await file.text()) : DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  settingsFile().write(JSON.stringify(settings));
}
