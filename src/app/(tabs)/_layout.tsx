import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
  return (
    <NativeTabs disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="device">
        <NativeTabs.Trigger.Icon sf={{ default: 'wave.3.right', selected: 'wave.3.right' }} />
        <NativeTabs.Trigger.Label>Device</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="recordings">
        <NativeTabs.Trigger.Icon sf={{ default: 'waveform', selected: 'waveform' }} />
        <NativeTabs.Trigger.Label>Recordings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="diagnostics">
        <NativeTabs.Trigger.Icon sf={{ default: 'stethoscope', selected: 'stethoscope' }} />
        <NativeTabs.Trigger.Label>Diagnostics</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
