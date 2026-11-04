import type { LocalRecording } from '../pocket/types';
import { recordingKey } from '../transcription/state';
import { compareNoteEntries, MAX_NOTE_LENGTH, parseNotes, type NoteEntry } from './state';

interface Dependencies {
  loadEntries(): Promise<Record<string, NoteEntry>>;
  saveEntries(entries: Record<string, NoteEntry>): Promise<void>;
  revision(): string;
  now?(): number;
}

const SAVE_ERROR = 'Could not save the note on this device. Your draft is still here. Free some storage and try again.';
const LOAD_ERROR = 'Saved notes could not be read. Restart OpenPocket before editing or syncing notes.';
const BUSY_ERROR = 'A note is being saved. Try again when it finishes.';

/** One publication at a time; only durable edits become visible to sync. */
export function createNotesController(deps: Dependencies) {
  let entries: Record<string, NoteEntry> = {};
  let loading = true;
  let ready = false;
  let saving = false;
  let error: string | null = null;
  let loadPromise: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const unavailable = () => loading || !ready ? LOAD_ERROR : saving ? BUSY_ERROR : null;

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot() {
      return { loading, saving, error, entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, { ...entry }])) };
    },
    load() {
      loadPromise ??= (async () => {
        try {
          entries = parseNotes(Object.values(await deps.loadEntries()));
          ready = true;
        } catch { error = LOAD_ERROR; }
        loading = false;
        notify();
      })();
      return loadPromise;
    },
    clearError() { error = null; notify(); },
    async save(recording: LocalRecording, text: string, expectedRevision?: string | null): Promise<boolean> {
      const unavailableError = unavailable();
      if (unavailableError) { error = unavailableError; notify(); return false; }
      let key: string;
      try { key = recordingKey(recording); }
      catch { error = 'This saved recording is invalid.'; notify(); return false; }
      if (typeof text !== 'string' || text.length > MAX_NOTE_LENGTH) {
        error = `Keep the note under ${MAX_NOTE_LENGTH.toLocaleString()} characters.`;
        notify();
        return false;
      }
      const previous = entries[key];
      if (expectedRevision !== undefined && expectedRevision !== (previous?.revision ?? null)) {
        error = 'The saved note changed while you were editing. Your draft is still here. Review the current note before saving.';
        notify();
        return false;
      }
      if (previous?.text === text) { error = null; notify(); return true; }
      saving = true;
      error = null;
      notify();
      try {
        // Editing a synced revision must always advance it, even after clock changes.
        const updatedAt = new Date(Math.max((deps.now ?? Date.now)(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
        const nextEntry = parseNotes([{ recordingKey: key, text, updatedAt, revision: deps.revision() }])[key];
        const next = { ...entries, [key]: nextEntry };
        await deps.saveEntries(next);
        entries = next;
        error = null;
        return true;
      } catch { error = SAVE_ERROR; return false; }
      finally { saving = false; notify(); }
    },
    async merge(incoming: NoteEntry[], expectedRevisions?: Record<string, string | null>): Promise<void> {
      const unavailableError = unavailable();
      if (unavailableError) throw new Error(unavailableError);
      const validated = parseNotes(incoming);
      const next = { ...entries };
      let changed = false;
      for (const entry of Object.values(validated)) {
        const current = next[entry.recordingKey];
        if (expectedRevisions !== undefined && (!Object.hasOwn(expectedRevisions, entry.recordingKey)
          || expectedRevisions[entry.recordingKey] !== (current?.revision ?? null))) {
          throw new Error('The local note changed during sync. Try syncing again to save its current version first.');
        }
        if (current?.revision === entry.revision
          && (current.text !== entry.text || current.updatedAt !== entry.updatedAt)) {
          throw new Error('A synced note revision has conflicting contents. The saved note was kept.');
        }
        if (!current || compareNoteEntries(entry, current) > 0) {
          next[entry.recordingKey] = entry;
          changed = true;
        }
      }
      if (!changed) return;
      saving = true;
      notify();
      try {
        await deps.saveEntries(next);
        entries = next;
        error = null;
      } catch {
        error = 'Synced notes could not be saved on this device. The existing notes were kept. Try syncing again.';
        throw new Error(error);
      } finally { saving = false; notify(); }
    },
  };
}
