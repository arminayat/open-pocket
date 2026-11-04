import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { ActionButton } from '@/components/action-button';
import { NoteEditor, useNoteMarkdownStyle } from '@/components/note-editor';
import { AppText } from '@/components/screen';
import { useNotes } from '@/contexts/notes-context';
import type { LocalRecording } from '@/lib/pocket/types';
import { MAX_NOTE_LENGTH } from '@/lib/notes/state';
import { recordingKey } from '@/lib/transcription/state';

/** Your own Markdown notes for a recording; edits are revision-checked against notes synced from other devices. */
export function RecordingNotes({ recording }: { recording: LocalRecording }) {
  const notes = useNotes();
  const { style } = useNoteMarkdownStyle();
  const foreground = useThemeColor('foreground');
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [baselineKey, setBaselineKey] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const key = recordingKey(recording);
  const entry = notes.entries[key];
  const disabled = notes.loading || notes.saving;
  const copyChanged = editing && baselineKey !== key;
  const changed = editing && (copyChanged || baseline !== (entry?.revision ?? null));

  const edit = () => {
    setBaseline(entry?.revision ?? null);
    setBaselineKey(key);
    setReviewing(false);
    setTooLong(false);
    setEditing(true);
    notes.clearError();
  };
  const save = async (markdown: string) => {
    if (changed) return;
    if (markdown.length > MAX_NOTE_LENGTH) { setTooLong(true); return; }
    if (await notes.save(recording, markdown, baseline)) {
      setEditing(false);
      setReviewing(false);
    }
  };

  return <View className="gap-3">
    <View className="flex-row items-center justify-between gap-3">
      <Card.Title className="flex-1">Notes</Card.Title>
      {Boolean(entry?.text) && <Button isIconOnly size="sm" variant="ghost" className="-my-2 -mr-2" isDisabled={disabled}
        accessibilityLabel="Edit notes" onPress={edit}>
        <Ionicons name="create-outline" size={20} color={foreground} />
      </Button>}
    </View>
    {entry?.text ? <EnrichedMarkdownText markdown={entry.text} markdownStyle={style} /> : <>
      <AppText className="text-sm text-muted">Only you write these. They sync with iCloud when it is on.</AppText>
      <View className="items-start"><ActionButton icon="add" label="Add note" isDisabled={disabled} onPress={edit} /></View>
    </>}
    {notes.error && !editing && !entry && <AppText className="text-sm text-danger" accessibilityRole="alert">{notes.error}</AppText>}
    <NoteEditor visible={editing} initial={entry?.text ?? ''} saving={notes.saving} canSave={!changed}
      onCancel={() => { setEditing(false); setReviewing(false); notes.clearError(); }} onSave={markdown => void save(markdown)}>
      {changed && <View className="items-start gap-2">
        <AppText className="text-sm text-warning" accessibilityRole="alert">{copyChanged
          ? 'A different copy of this recording is now selected. Your draft is still here. Review its saved notes before using your draft for this copy.'
          : 'Newer notes were synced while you were editing. Your draft is still here.'}</AppText>
        {!reviewing ? <ActionButton icon="eye-outline" label="Review saved notes" onPress={() => setReviewing(true)} /> : <>
          <AppText className="text-xs text-muted">Current saved notes</AppText>
          {entry?.text ? <EnrichedMarkdownText markdown={entry.text} markdownStyle={style} />
            : <AppText className="text-sm">The saved notes are empty.</AppText>}
          <AppText className="text-xs text-muted">Keeping your draft lets you save it over this version. Cancel to keep the current saved notes.</AppText>
          <ActionButton icon="checkmark" label="Keep my draft" isDisabled={disabled} onPress={() => {
            setBaseline(entry?.revision ?? null); setBaselineKey(key); setReviewing(false); notes.clearError();
          }} />
        </>}
      </View>}
      {tooLong && <AppText className="text-sm text-danger" accessibilityRole="alert">Keep notes under {MAX_NOTE_LENGTH.toLocaleString()} characters.</AppText>}
      {notes.error && <AppText className="text-sm text-danger" accessibilityRole="alert">{notes.error}</AppText>}
    </NoteEditor>
  </View>;
}
