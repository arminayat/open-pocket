import { createContext, useContext, useEffect, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { createNotesController } from '@/lib/notes/controller';
import { loadNotes, saveNotes } from '@/storage/notes';

function createController() {
  return createNotesController({ loadEntries: loadNotes, saveEntries: saveNotes, revision: randomUUID });
}
type Controller = ReturnType<typeof createController>;
type State = ReturnType<Controller['snapshot']> & Pick<Controller, 'save' | 'merge' | 'clearError'>;
const NotesContext = createContext<State | null>(null);

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(createController);
  const [state, setState] = useState(() => client.snapshot());
  useEffect(() => {
    const unsubscribe = client.subscribe(() => setState(client.snapshot()));
    void client.load();
    return unsubscribe;
  }, [client]);
  return <NotesContext.Provider value={{ ...state, save: client.save, merge: client.merge, clearError: client.clearError }}>
    {children}
  </NotesContext.Provider>;
}

export function useNotes() {
  const context = useContext(NotesContext);
  if (!context) throw new Error('NotesProvider is missing.');
  return context;
}
