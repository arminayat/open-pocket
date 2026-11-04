import Svg, { Defs, LinearGradient, Rect, Stop, Text } from 'react-native-svg';
import type { RecorderColor } from '@/lib/pocket/protocol';

/** Body gradient (light, mid, dark) and edge for each sold finish: Space Grey, Sierra Blue, Baby Pink. */
const FINISH: Record<RecorderColor, { light: string; mid: string; dark: string; edge: string }> = {
  grey: { light: '#6a6d73', mid: '#4f5257', dark: '#3c3e42', edge: '#2f3134' },
  blue: { light: '#a9c8ea', mid: '#86aad6', dark: '#6688b5', edge: '#56769f' },
  pink: { light: '#e6bccb', mid: '#cf9fb1', dark: '#b08292', edge: '#9a6f7f' },
};

// Portrait front view of the Pocket recorder: a credit-card-sized aluminium slab with an
// engraved serif wordmark, an LED pinhole, and the side button. Proportions follow the
// 54 × 86 mm card shape.
export function PocketDevice({ connected, color = 'grey', width = 56 }: { connected: boolean; color?: RecorderColor; width?: number }) {
  const finish = FINISH[color];
  return (
    <Svg width={width} height={(width * 86) / 55} viewBox="0 0 55 86" accessible={false}>
      <Defs>
        <LinearGradient id="pocket-body" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={finish.light} />
          <Stop offset="0.55" stopColor={finish.mid} />
          <Stop offset="1" stopColor={finish.dark} />
        </LinearGradient>
      </Defs>
      <Rect x="53.4" y="13" width="1.6" height="9" rx="0.8" fill={finish.dark} />
      <Rect x="0.5" y="0.5" width="53" height="85" rx="4.5" fill="url(#pocket-body)" stroke={finish.edge} strokeWidth="1" />
      <Rect x="1.6" y="1.6" width="50.8" height="82.8" rx="3.6" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="0.6" />
      <Rect x="7.6" y="7.6" width="2.4" height="2.4" rx="1.2" fill={connected ? '#4ade80' : '#26272a'} />
      {/* Engraving: a dark cut with a light lower edge, reading bottom to top along the right side. */}
      <Text x="-81" y="47.6" transform="rotate(-90)" fontFamily="Georgia" fontSize="24" fill="#000000" fillOpacity="0.16">Pocket</Text>
      <Text x="-81" y="47" transform="rotate(-90)" fontFamily="Georgia" fontSize="24" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="0.35">Pocket</Text>
    </Svg>
  );
}
