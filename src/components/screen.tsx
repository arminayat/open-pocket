import { ScrollView, Text, View, type TextProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function AppText({ className = '', style, ...props }: TextProps & { className?: string }) {
  return <Text {...props} className={`text-foreground ${className}`} style={[{ fontFamily: 'Inter_400Regular' }, style]} />;
}

export function Screen({ title, subtitle, children, action }: {
  title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: 120, paddingHorizontal: 22, gap: 18 }} keyboardShouldPersistTaps="handled">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <AppText className="text-xs uppercase tracking-widest text-muted">OpenPocket · Test build</AppText>
          <AppText accessibilityRole="header" className="text-3xl" style={{ fontFamily: 'Inter_600SemiBold' }}>{title}</AppText>
          <AppText className="text-sm leading-5 text-muted">{subtitle}</AppText>
        </View>
        {action}
      </View>
      {children}
    </ScrollView>
  );
}
