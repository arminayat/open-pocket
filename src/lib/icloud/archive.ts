import type { LocalRecording } from '../pocket/types';
import { isAiProviderId, validAiModelId } from '../ai/providers';
import { compareSummaries, type SummaryEntry } from '../ai/state';
import { MAX_NOTE_LENGTH } from '../notes/state';
import { isProviderId } from '../transcription/providers';
import { recordingKey } from '../transcription/state';
import type { ICloudMaterial, RecordingManifest, SummaryArtifact, TextArtifact, TranscriptArtifact } from './types';

export const MAX_AUDIO_BYTES = 2_000_000_000;
const MAX_JSON_BYTES = 8_000_000;
const hashPattern = /^[a-f0-9]{64}$/;
// Pocket names recordings `YYYYMMDDHHMMSS`; some (seen on firmware 1.8) use `PH` + `YYMMDDHHMMSS`.
const timestampPattern = /^(?:\d{14}|PH\d{12})$/;
const artifactPattern = /^(transcript|note|summary)-([a-f0-9]{64})\.json$/;
const revisionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid iCloud document.');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new Error('Invalid iCloud document fields.');
  }
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** The recording's wall-clock time as `YYYYMMDDHHMMSS`, whichever naming the recorder used. */
function wallClock(timestamp: string): string {
  return timestamp.startsWith('PH') ? `20${timestamp.slice(2)}` : timestamp;
}

function parseJson(text: string): Record<string, unknown> {
  // Native reads enforce the same byte ceiling; keep synthetic/import boundaries bounded too.
  if (text.length > MAX_JSON_BYTES || new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    throw new Error('The iCloud document is too large.');
  }
  return object(JSON.parse(text));
}

const MAX_FOLDER_BYTES = 200;
const byteLength = (text: string) => new TextEncoder().encode(text).length;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One folder-name component, matching the native rule: no separators, colons, control characters or leading dot.
 * Names are for people and may change; a recording's identity is the audio checksum in its `recording.json`.
 */
export function validFolderName(name: string): boolean {
  return Boolean(name) && byteLength(name) <= MAX_FOLDER_BYTES && !name.startsWith('.')
    && name.trim() === name && !/[/\\:\x00-\x1f\x7f]/.test(name);
}

/** A recording folder: `YYYY-MM-DD/<name>`, or a single top-level name (older layouts and folders people made). */
export function validFolderPath(path: string): boolean {
  const parts = path.split('/');
  return (parts.length === 1 || (parts.length === 2 && datePattern.test(parts[0]))) && parts.every(validFolderName);
}

/** The name folders had before readable names: date, Pocket timestamp and audio checksum, at the top level. */
export function legacyFolder(manifest: RecordingManifest): string {
  return `${manifest.date}_${manifest.timestamp}-${manifest.sha256}`;
}

/** A title made safe for a folder name: one line, no path characters, at most 80 characters. */
export function folderTitle(title: string): string {
  return title.normalize('NFC').replace(/[/\\:\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 80).trim();
}

function clockName(manifest: RecordingManifest, disambiguate: boolean): string {
  const clock = wallClock(manifest.timestamp);
  return `${clock.slice(8, 10)}.${clock.slice(10, 12)}${disambiguate ? ` (${manifest.sha256.slice(0, 6)})` : ''}`;
}

/**
 * `2026-10-20/14.00 – Title`: a folder per day, then one per recording. `disambiguate` adds a short checksum
 * when another recording already has that name.
 */
export function folderName(manifest: RecordingManifest, title?: string, disambiguate = false): string {
  const base = clockName(manifest, disambiguate);
  let suffix = title ? folderTitle(title) : '';
  while (suffix && byteLength(`${base} – ${suffix}`) > MAX_FOLDER_BYTES) suffix = suffix.slice(0, -1).trim();
  return `${manifest.date}/${suffix ? `${base} – ${suffix}` : base}`;
}

/** Names OpenPocket gives a recording's folder, current and earlier top-level ones, without a title. */
function ownedBases(manifest: RecordingManifest): string[] {
  return [false, true].flatMap(disambiguate => [`${manifest.date}/${clockName(manifest, disambiguate)}`,
    `${manifest.date} ${clockName(manifest, disambiguate)}`]);
}

/** OpenPocket only renames folders it named: legacy names, or names that start with the recording's date and time. */
export function ownsFolder(folder: string, manifest: RecordingManifest): boolean {
  return folder === legacyFolder(manifest) || ownedBases(manifest).some(base => folder === base || folder.startsWith(`${base} – `));
}

/** The title an OpenPocket-named folder already carries, so moving or merging it never drops the title. */
export function titleOfFolder(folder: string, manifest: RecordingManifest): string | undefined {
  const base = ownedBases(manifest).find(item => folder.startsWith(`${item} – `));
  return base ? folder.slice(base.length + 3) : undefined;
}

/** Only this schema's leaf files participate; temp files and arbitrary user files are ignored. */
export function archivePath(path: string): { folder: string; leaf: string } | null {
  const parts = path.split('/');
  if (parts.length < 2 || parts.length > 3) return null;
  const folder = parts.slice(0, -1).join('/');
  const leaf = parts[parts.length - 1];
  if (!validFolderPath(folder)) return null;
  if (!/^(?:recording\.json|audio\.mp3|transcript-[a-f0-9]{64}\.(?:json|txt)|(?:note|summary)-[a-f0-9]{64}\.(?:json|md))$/.test(leaf)) return null;
  return { folder, leaf };
}

export function parseManifest(text: string): RecordingManifest {
  const item = parseJson(text);
  exactKeys(item, ['schema', 'id', 'date', 'timestamp', 'durationSeconds', 'bytes', 'sha256']);
  if (item.schema !== 1 || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
    || typeof item.timestamp !== 'string' || !timestampPattern.test(item.timestamp)
    || wallClock(item.timestamp).slice(0, 8) !== item.date.replaceAll('-', '')
    || item.id !== `${item.date}/${item.timestamp}`
    || typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds)
    || item.durationSeconds < 0 || item.durationSeconds > 7 * 24 * 60 * 60
    || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_AUDIO_BYTES
    || typeof item.sha256 !== 'string' || !hashPattern.test(item.sha256)) {
    throw new Error('Invalid iCloud recording metadata.');
  }
  const clock = wallClock(item.timestamp);
  const time = `${item.date}T${clock.slice(8, 10)}:${clock.slice(10, 12)}:${clock.slice(12, 14)}.000Z`;
  if (!canonicalDate(time)) throw new Error('Invalid iCloud recording date.');
  const manifest: RecordingManifest = {
    schema: 1, id: item.id, date: item.date, timestamp: item.timestamp,
    durationSeconds: item.durationSeconds, bytes: item.bytes, sha256: item.sha256,
  };
  return manifest;
}

export function manifestForRecording(recording: LocalRecording, sha256: string): RecordingManifest {
  const manifest: RecordingManifest = {
    schema: 1, id: recording.id, date: recording.date, timestamp: recording.timestamp,
    durationSeconds: recording.durationSeconds, bytes: recording.bytes, sha256,
  };
  return parseManifest(JSON.stringify(manifest));
}

export function parseArtifact(text: string, leaf: string, sha256: string): TextArtifact {
  const match = artifactPattern.exec(leaf);
  if (!match || !hashPattern.test(sha256) || match[2] !== sha256) throw new Error('The iCloud document checksum is invalid.');
  const item = parseJson(text);
  if (item.schema !== 1 || item.kind !== match[1] || typeof item.text !== 'string' || !canonicalDate(item.updatedAt)) {
    throw new Error('Invalid iCloud text document.');
  }
  if (item.kind === 'transcript') {
    exactKeys(item, ['schema', 'kind', 'text', 'updatedAt', 'provider', 'model']);
    if (item.text.length > 2_000_000 || !isProviderId(item.provider) || typeof item.model !== 'string'
      || !item.model || item.model.length > 100 || /[\x00-\x1f\x7f]/.test(item.model)) {
      throw new Error('Invalid iCloud transcript.');
    }
  } else if (item.kind === 'summary') {
    exactKeys(item, ['schema', 'kind', 'title', 'text', 'updatedAt', 'provider', 'model']);
    if (typeof item.title !== 'string' || !item.title || item.title.length > 80 || /[\x00-\x1f\x7f]/.test(item.title)
      || !item.text || item.text.length > 20_000 || !isAiProviderId(item.provider) || !validAiModelId(item.model)) {
      throw new Error('Invalid iCloud summary.');
    }
  } else {
    exactKeys(item, ['schema', 'kind', 'text', 'updatedAt', 'revision']);
    if (item.text.length > MAX_NOTE_LENGTH || typeof item.revision !== 'string' || !revisionPattern.test(item.revision)) {
      throw new Error('Invalid iCloud note.');
    }
  }
  return item as unknown as TextArtifact;
}

/** Project only completed persisted text; credentials, job receipts and errors never leave the device. */
export function artifactsForMaterial(material: ICloudMaterial): TextArtifact[] {
  const { recording, transcript, note, summary } = material;
  const key = recordingKey(recording);
  const artifacts: TextArtifact[] = [];
  if (transcript?.recordingKey === key && transcript.status === 'complete' && !transcript.unsaved
    && typeof transcript.text === 'string' && transcript.model) {
    artifacts.push({
      schema: 1, kind: 'transcript', text: transcript.text, updatedAt: transcript.updatedAt,
      provider: transcript.provider, model: transcript.model,
    });
  }
  if (note?.recordingKey === key) {
    artifacts.push({ schema: 1, kind: 'note', text: note.text, updatedAt: note.updatedAt, revision: note.revision });
  }
  if (summary?.recordingKey === key) {
    artifacts.push({ schema: 1, kind: 'summary', title: summary.title, text: summary.summary, updatedAt: summary.updatedAt,
      provider: summary.provider, model: summary.model });
  }
  return artifacts;
}

export function compareTranscriptArtifacts(a: TranscriptArtifact, b: TranscriptArtifact): number {
  const date = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  const aTie = JSON.stringify([a.provider, a.model, a.text]);
  const bTie = JSON.stringify([b.provider, b.model, b.text]);
  return date || (aTie < bTie ? -1 : aTie > bTie ? 1 : 0);
}

/** The local summary entry an iCloud summary document describes. */
export function summaryEntry(key: string, artifact: SummaryArtifact): SummaryEntry {
  return { recordingKey: key, provider: artifact.provider, model: artifact.model, title: artifact.title,
    summary: artifact.text, updatedAt: artifact.updatedAt };
}

export function compareArtifacts(a: TextArtifact, b: TextArtifact): number {
  if (a.kind === 'transcript' && b.kind === 'transcript') return compareTranscriptArtifacts(a, b);
  if (a.kind === 'summary' && b.kind === 'summary') return compareSummaries(summaryEntry('', a), summaryEntry('', b));
  if (a.kind !== 'note' || b.kind !== 'note') throw new Error('Cannot compare different document kinds.');
  return Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || (a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0);
}
