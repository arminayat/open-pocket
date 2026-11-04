import { Stack } from 'expo-router';
import { TITLE_FONT } from './screen';

/** Native iOS large-title header that collapses into the standard bar on scroll. */
export function TabStack({ title }: { title: string }) {
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: true, headerTransparent: true, headerShadowVisible: false, headerLargeTitleShadowVisible: false,
      headerBackButtonDisplayMode: 'minimal',
      headerLargeTitleStyle: { fontFamily: TITLE_FONT }, headerTitleStyle: { fontFamily: TITLE_FONT } }}>
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
