import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { createChatGPTAccounts } from '@/lib/chatgpt/accounts';
import { authorizeChatGPT } from '@/lib/chatgpt/authorization';
import { refreshTokens, revokeTokens } from '@/lib/chatgpt/http';
import { loadChatGPTAccounts, saveChatGPTAccounts } from '@/storage/chatgpt';

function createAccounts() {
  return createChatGPTAccounts({
    load: loadChatGPTAccounts, save: saveChatGPTAccounts,
    newHostId: () => `urn:uuid:${Crypto.randomUUID()}`,
    authorize: authorizeChatGPT, refresh: refreshTokens, revoke: revokeTokens,
  });
}
type Accounts = ReturnType<typeof createAccounts>;
type ChatGPTState = ReturnType<Accounts['snapshot']> & Pick<Accounts, 'connect' | 'signOut' | 'clearError' | 'planToken'>;
const ChatGPTContext = createContext<ChatGPTState | null>(null);

export function ChatGPTProvider({ children }: { children: React.ReactNode }) {
  const [accounts] = useState(createAccounts);
  const [state, setState] = useState(() => accounts.snapshot());
  useEffect(() => {
    const unsubscribe = accounts.subscribe(() => setState(accounts.snapshot()));
    void accounts.load().then(() => accounts.refreshActive());
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void accounts.refreshActive();
    });
    // Only renew the active account while OpenPocket is in use; never run AI in the background.
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void accounts.refreshActive();
    }, 60_000);
    return () => { unsubscribe(); subscription.remove(); clearInterval(timer); };
  }, [accounts]);
  return <ChatGPTContext.Provider value={{ ...state, connect: accounts.connect, signOut: accounts.signOut, clearError: accounts.clearError, planToken: accounts.planToken }}>{children}</ChatGPTContext.Provider>;
}

export function useChatGPT() {
  const context = useContext(ChatGPTContext);
  if (!context) throw new Error('ChatGPTProvider is missing.');
  return context;
}
