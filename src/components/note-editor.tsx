import { useRef, useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { Button, useThemeColor } from 'heroui-native';
import { MaterialIcons } from '@expo/vector-icons';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  EnrichedMarkdownTextInput, type EnrichedMarkdownTextInputInstance, type StyleState,
} from 'react-native-enriched-markdown';
import { AppText, TITLE_FONT } from './screen';

type Icon = React.ComponentProps<typeof MaterialIcons>['name'];
type Tool = { icon: Icon; label: string; active?: (state: StyleState) => boolean; run(input: EnrichedMarkdownTextInputInstance): void };

const TOOLS: Tool[] = [
  { icon: 'format-bold', label: 'Bold', active: state => state.bold.isActive, run: input => input.toggleBold() },
  { icon: 'format-italic', label: 'Italic', active: state => state.italic.isActive, run: input => input.toggleItalic() },
  { icon: 'format-strikethrough', label: 'Strikethrough', active: state => state.strikethrough.isActive, run: input => input.toggleStrikethrough() },
  { icon: 'title', label: 'Heading', active: state => state.heading.isActive, run: input => input.toggleHeading(2) },
  { icon: 'format-list-bulleted', label: 'Bulleted list', active: state => state.unorderedList.isActive, run: input => input.toggleUnorderedList() },
  { icon: 'format-list-numbered', label: 'Numbered list', active: state => state.orderedList.isActive, run: input => input.toggleOrderedList() },
  { icon: 'format-indent-decrease', label: 'Outdent', run: input => input.outdentList() },
  { icon: 'format-indent-increase', label: 'Indent', run: input => input.indentList() },
];

/** Markdown colors that follow the app theme, shared by the editor and the rendered notes. */
export function useNoteMarkdownStyle() {
  const [foreground, muted, accent] = useThemeColor(['foreground', 'muted', 'accent']);
  return { foreground, muted, accent, style: {
    paragraph: { color: foreground, fontSize: 15, lineHeight: 22 },
    h1: { color: foreground, fontSize: 24, fontWeight: '700' as const },
    h2: { color: foreground, fontSize: 20, fontWeight: '700' as const },
    h3: { color: foreground, fontSize: 17, fontWeight: '600' as const },
    list: { color: foreground, fontSize: 15, lineHeight: 22, bulletColor: muted },
    strong: { color: foreground },
    em: { color: foreground },
    link: { color: accent, underline: true },
  } };
}

/**
 * A full-screen Markdown editor for a recording's notes in a native page sheet. It closes only through
 * Cancel (which asks before dropping changes) or a successful Save, never by an accidental swipe.
 */
export function NoteEditor({ visible, initial, saving, canSave, onCancel, onSave, children }: {
  visible: boolean; initial: string; saving: boolean; canSave: boolean;
  onCancel(): void; onSave(markdown: string): void; children?: React.ReactNode;
}) {
  const input = useRef<EnrichedMarkdownTextInputInstance>(null);
  const [state, setState] = useState<StyleState | null>(null);
  const [dirty, setDirty] = useState(false);
  const insets = useSafeAreaInsets();
  const { foreground, muted, accent, style } = useNoteMarkdownStyle();
  const background = useThemeColor('background');

  const cancel = () => {
    if (!dirty) { onCancel(); return; }
    Alert.alert('Discard changes?', 'Your edits to these notes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onCancel },
    ]);
  };
  const save = async () => {
    const markdown = await input.current?.getMarkdown();
    if (markdown !== undefined) onSave(markdown.trim());
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={false}
      onRequestClose={cancel} onShow={() => { setDirty(false); setState(null); }}>
      <View style={{ flex: 1, backgroundColor: background }}>
        <View className="flex-row items-center justify-between px-3 pb-2 pt-4">
          <Button size="sm" variant="ghost" isDisabled={saving} onPress={cancel}>Cancel</Button>
          <AppText accessibilityRole="header" className="text-2xl" style={{ fontFamily: TITLE_FONT }}>Notes</AppText>
          <Button size="sm" variant="primary" isDisabled={saving || !canSave} onPress={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
        </View>
        {children && <View className="gap-2 px-5 pb-2">{children}</View>}
        <EnrichedMarkdownTextInput ref={input} defaultValue={initial} autoFocus markdownShortcuts
          placeholder="Write your notes…"
          placeholderTextColor={muted} cursorColor={accent} selectionColor={accent}
          markdownStyle={{ strong: style.strong, em: style.em, link: style.link }}
          onChangeState={setState} onChangeMarkdown={markdown => setDirty(markdown.trim() !== initial.trim())}
          style={{ flex: 1, color: foreground, fontSize: 17, paddingHorizontal: 20, paddingTop: 8 }} />
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View className="flex-row justify-between border-t border-separator px-3 py-2"
            style={{ backgroundColor: background, paddingBottom: Math.max(insets.bottom, 8) }}>
            {TOOLS.map(tool => {
              const active = Boolean(state && tool.active?.(state));
              return <Pressable key={tool.label} accessibilityRole="button" accessibilityLabel={tool.label}
                accessibilityState={{ selected: active }} hitSlop={6} className="rounded-lg p-1.5 active:opacity-50"
                onPress={() => { if (input.current) tool.run(input.current); }}>
                <MaterialIcons name={tool.icon} size={24} color={active ? accent : foreground} />
              </Pressable>;
            })}
          </View>
        </KeyboardStickyView>
      </View>
    </Modal>
  );
}
