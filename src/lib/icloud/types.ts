import type { LocalRecording } from '../pocket/types';
import type { AiProviderId } from '../ai/providers';
import type { SummaryEntry } from '../ai/state';
import type { NoteEntry } from '../notes/state';
import type { TranscriptEntry } from '../transcription/state';
import type { ProviderId } from '../transcription/types';

export interface RecordingManifest {
  schema: 1;
  id: string;
  date: string;
  timestamp: string;
  durationSeconds: number;
  bytes: number;
  sha256: string;
}

export interface TranscriptArtifact {
  schema: 1;
  kind: 'transcript';
  text: string;
  updatedAt: string;
  provider: ProviderId;
  model: string;
}

export interface NoteArtifact {
  schema: 1;
  kind: 'note';
  text: string;
  updatedAt: string;
  revision: string;
}

/** An AI-written title and summary; `text` is the summary. */
export interface SummaryArtifact {
  schema: 1;
  kind: 'summary';
  title: string;
  text: string;
  updatedAt: string;
  provider: AiProviderId;
  model: string;
}

export type TextArtifact = TranscriptArtifact | NoteArtifact | SummaryArtifact;

export interface ICloudFile {
  path: string;
  downloaded: boolean;
  uploaded: boolean;
  conflict: boolean;
}

export interface ICloudTransport {
  identify(uri: string, expectedBytes: number): Promise<string>;
  scan(session: string): Promise<{ gathering: boolean; files: ICloudFile[]; errors: number }>;
  putAudio(session: string, folder: string, uri: string, bytes: number, sha: string): Promise<void>;
  putText(session: string, path: string, text: string): Promise<void>;
  readText(session: string, path: string): Promise<string | null>;
  downloadAudio(session: string, path: string, bytes: number, sha: string): Promise<string | null>;
  /**
   * Renames a recording folder, or merges it into `to` when that exists: missing files move across and
   * byte-identical duplicates are removed; anything else stays. `sha256` is the recording's audio checksum.
   */
  moveFolder(session: string, from: string, to: string, sha256: string): Promise<void>;
}

export interface ICloudMaterial {
  recording: LocalRecording;
  transcript?: TranscriptEntry;
  note?: NoteEntry;
  summary?: SummaryEntry;
}

export interface ICloudSyncOptions {
  session: string;
  materials: ICloudMaterial[];
  transport: ICloudTransport;
  sha256(text: string): Promise<string>;
  audioHashes: Map<string, string>;
  importRecording(manifest: RecordingManifest, uri: string): Promise<LocalRecording>;
  mergeTranscript(recording: LocalRecording, artifact: TranscriptArtifact): Promise<void>;
  mergeNote(recording: LocalRecording, artifact: NoteArtifact): Promise<void>;
  mergeSummary(recording: LocalRecording, artifact: SummaryArtifact): Promise<void>;
  /** Throws after opt-out or an account/session change. Also checked after native calls. */
  checkActive(): void;
  onStage?(stage: string): void;
  /** Each counted failure, with what was being done, so the cause is not lost. */
  onError?(context: string, cause: unknown): void;
}

export interface ICloudSyncResult {
  pending: number;
  errors: number;
  conflicts: number;
  published: number;
  imported: number;
  uploaded: number;
}
