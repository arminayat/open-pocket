import { Text, type TextProps } from 'react-native';
import { useThemeColor } from 'heroui-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

/** Every title (headers, cards, sheets) uses Instrument Serif; body text uses Inter. */
export const TITLE_FONT = 'InstrumentSerif_400Regular';

export function AppText({ className = '', style, ...props }: TextProps & { className?: string }) {
  return <Text {...props} className={`text-foreground ${className}`} style={[{ fontFamily: 'Inter_400Regular' }, style]} />;
}

/**
 * Scroll content under the native large-title header; the inset lets the title collapse on scroll.
 * A focused text field scrolls above the keyboard.
 */
export function Screen({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  const background = useThemeColor('background');
  return (
    <KeyboardAwareScrollView style={{ flex: 1, backgroundColor: background }} contentInsetAdjustmentBehavior="automatic"
      bottomOffset={24} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: 0, paddingBottom: 40, paddingHorizontal: 22, gap: 18 }}>
      {subtitle && <AppText className="text-sm leading-5 text-muted">{subtitle}</AppText>}
      {children}
    </KeyboardAwareScrollView>
  );
}
