import { useState } from 'react';
import { Pressable } from 'react-native';
import { useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './screen';
import { Sheet, type SheetAction } from './sheet';

/**
 * Opens details in the shared bottom sheet: a quiet "Learn more" text link, or an ⓘ button for
 * list rows. Neither is taller than the text beside it. `primary` adds a main action next to Close.
 */
export function LearnMore({ title, icon = false, primary, children }:
  { title: string; icon?: boolean; primary?: SheetAction; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const accent = useThemeColor('accent');
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Learn more about ${title}`} hitSlop={12}
      onPress={() => setOpen(true)} className="active:opacity-50">
      {icon ? <Ionicons name="information-circle-outline" size={24} color={accent} />
        : <AppText className="text-sm" style={{ fontFamily: 'Inter_500Medium' }}>Learn more</AppText>}
    </Pressable>
    <Sheet title={title} visible={open} onClose={() => setOpen(false)} primary={primary}>{children}</Sheet>
  </>;
}
