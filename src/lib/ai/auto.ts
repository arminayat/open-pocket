import { latestCopy } from '../pocket/recording-list';
import type { LocalRecording } from '../pocket/types';
import { recordingKey, type TranscriptEntry } from '../transcription/state';
import type { SummaryEntry } from './state';

export interface SummaryCandidate { recording: LocalRecording; transcript: string }

/** Recordings automatic summaries would send, newest first: the copy each page shows, with a transcript and no summary, not imported from iCloud. */
export function unsummarized(library: LocalRecording[], transcripts: Record<string, TranscriptEntry>,
  summaries: Record<string, SummaryEntry>): SummaryCandidate[] {
  const ids = [...new Set(library.map(recording => recording.id))].sort((a, b) => b.localeCompare(a));
  return ids.flatMap(id => {
    const recording = latestCopy(library, id);
    // iCloud imports may get their summary from the device that made them; summarize those by hand.
    if (!recording || recording.transport === 'icloud') return [];
    try {
      const key = recordingKey(recording);
      const transcript = transcripts[key];
      const text = transcript?.status === 'complete' && !transcript.unsaved ? transcript.text?.trim() : '';
      return text && !summaries[key] ? [{ recording, transcript: text }] : [];
    } catch { return []; }
  });
}

/** The summary of the copy a recording's page shows, if any. */
export function summaryFor(library: LocalRecording[], summaries: Record<string, SummaryEntry>, id: string): SummaryEntry | undefined {
  const recording = latestCopy(library, id);
  if (!recording) return undefined;
  try { return summaries[recordingKey(recording)]; } catch { return undefined; }
}
