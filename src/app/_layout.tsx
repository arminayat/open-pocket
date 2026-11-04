import '../../global.css';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { HeroUINativeProvider } from 'heroui-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { StatusBar } from 'expo-status-bar';
import { AppThemeProvider, useAppTheme } from '@/contexts/app-theme-context';
import { PocketProvider } from '@/contexts/pocket-context';
import { ChatGPTProvider } from '@/contexts/chatgpt-context';
import { TranscriptionProvider } from '@/contexts/transcription-context';
import { AiProvider } from '@/contexts/ai-context';
import { NotesProvider } from '@/contexts/notes-context';
import { ICloudProvider } from '@/contexts/icloud-context';
import { ErrorAlert } from '@/components/error-notice';

function App() {
  const { isDark } = useAppTheme();
  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <PocketProvider>
        <ChatGPTProvider>
          <TranscriptionProvider>
            <AiProvider>
              <NotesProvider>
                <ICloudProvider>
                  {/* Innermost, so sheets and popovers it renders in its portal can still read app state. */}
                  <HeroUINativeProvider>
                    <StatusBar style={isDark ? 'light' : 'dark'} />
                    <ErrorAlert />
                    <Stack screenOptions={{ headerShown: false }} />
                  </HeroUINativeProvider>
                </ICloudProvider>
              </NotesProvider>
            </AiProvider>
          </TranscriptionProvider>
        </ChatGPTProvider>
      </PocketProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, InstrumentSerif_400Regular });
  if (!loaded && !error) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AppThemeProvider><App /></AppThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
