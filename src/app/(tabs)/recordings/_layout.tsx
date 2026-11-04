import { TabStack } from '@/components/tab-stack';

// Pages opened from another tab or a link keep the tab's main page underneath, so they get a back button.
export const unstable_settings = { initialRouteName: 'index' };

export default function RecordingsLayout() { return <TabStack title="Recordings" />; }
