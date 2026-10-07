import { createContext, useContext } from 'react';
import { Uniwind, useUniwind } from 'uniwind';

const ThemeContext = createContext({ isDark: false, toggleTheme: () => {} });

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useUniwind();
  return (
    <ThemeContext.Provider value={{ isDark: theme === 'dark', toggleTheme: () => Uniwind.setTheme(theme === 'dark' ? 'light' : 'dark') }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useAppTheme = () => useContext(ThemeContext);
