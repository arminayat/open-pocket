import { Redirect } from 'expo-router';
import { usePocket } from '@/contexts/pocket-context';

/** Until a recorder is set up, open on Settings, where the setup steps are; afterwards on Recordings. */
export default function Index() {
  const pocket = usePocket();
  if (pocket.busy === 'loading') return null;
  return <Redirect href={pocket.saved ? '/(tabs)/recordings' : '/(tabs)/settings'} />;
}
