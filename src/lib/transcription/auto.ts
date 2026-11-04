import { latestCopy } from '../pocket/recording-list';
import type { LocalRecording } from '../pocket/types';
import { recordingKey, type TranscriptEntry } from './state';

/**
 * Recordings automatic transcription would upload, newest first: the copy each recording page shows,
 * with no transcript or attempt yet. iCloud imports are skipped; their device may already have transcribed them.
 */
export function untranscribed(library: LocalRecording[], entries: Record<string, TranscriptEntry>): LocalRecording[] {
  const ids = [...new Set(library.map(recording => recording.id))].sort((a, b) => b.localeCompare(a));
  return ids.flatMap(id => {
    const recording = latestCopy(library, id);
    if (!recording || recording.transport === 'icloud') return [];
    try { return entries[recordingKey(recording)] ? [] : [recording]; }
    catch { return []; }
  });
}
