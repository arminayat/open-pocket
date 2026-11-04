import { View } from 'react-native';
import { BottomSheet, Button, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { AppText, TITLE_FONT } from './screen';

export interface SheetAction { label: string; onPress(): void; isDisabled?: boolean }

/** Sheet copy: one short lead sentence, then a few points. Keep each point to one idea. */
export function SheetLead({ children }: { children: React.ReactNode }) {
  return <AppText className="text-base leading-6">{children}</AppText>;
}

export function SheetPoint({ icon, children }: { icon: React.ComponentProps<typeof Ionicons>['name']; children: React.ReactNode }) {
  const muted = useThemeColor('muted');
  return (
    <View className="flex-row items-start gap-3">
      {/* A box one text line tall, so the icon centres on the first line whatever the glyph's own padding. */}
      <View style={{ height: 20 }} className="justify-center">
        <Ionicons name={icon} size={18} color={muted} />
      </View>
      <AppText className="flex-1 text-sm leading-5 text-muted">{children}</AppText>
    </View>
  );
}

/**
 * A bottom sheet with its actions in one row at the bottom, within thumb reach: a secondary (Close unless given)
 * and a primary, or a single Done. Short content sizes the sheet to fit; `scrollable` content (long text) gets a
 * fixed 85% sheet that scrolls above the actions, as HeroUI recommends, since a scroll view cannot be measured
 * for dynamic sizing. Swiping down or tapping outside also closes it. HeroUI's container supplies the padding.
 */
export function Sheet({ title, visible, onClose, primary, secondary, scrollable = false, children }: {
  title: string; visible: boolean; onClose(): void; primary?: SheetAction; secondary?: SheetAction;
  scrollable?: boolean; children: React.ReactNode;
}) {
  const main = primary ?? { label: 'Done', onPress: onClose };
  const other = primary ? secondary ?? { label: 'Close', onPress: onClose } : undefined;
  const heading = <AppText accessibilityRole="header" className="text-3xl" style={{ fontFamily: TITLE_FONT }}>{title}</AppText>;
  const actions = (
    <View className="flex-row gap-3 pt-6">
      {other && <Button className="flex-1" variant="secondary" isDisabled={other.isDisabled} onPress={other.onPress}>{other.label}</Button>}
      <Button className="flex-1" variant="primary" isDisabled={main.isDisabled} onPress={main.onPress}>{main.label}</Button>
    </View>
  );
  return (
    <BottomSheet isOpen={visible} onOpenChange={open => { if (!open) onClose(); }}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        {scrollable ? (
          <BottomSheet.Content snapPoints={['85%']} enableDynamicSizing={false} enableOverDrag={false} contentContainerClassName="h-full">
            <BottomSheetScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
              {heading}
              {children}
            </BottomSheetScrollView>
            {actions}
          </BottomSheet.Content>
        ) : (
          <BottomSheet.Content>
            <View className="gap-3">
              {heading}
              {children}
            </View>
            {actions}
          </BottomSheet.Content>
        )}
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
