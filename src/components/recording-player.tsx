import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Slider, useThemeColor } from 'heroui-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { LocalRecording } from '@/lib/pocket/types';
import { AppText } from './screen';

const SKIP_SECONDS = 5;

function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }

/** Full transport for a recording page: draggable position, 5-second skips, and play/pause. */
export function RecordingPlayer({ recording }: { recording: LocalRecording }) {
  const player = useAudioPlayer(recording.uri);
  const status = useAudioPlayerStatus(player);
  const [foreground, background] = useThemeColor(['foreground', 'background']);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Position under the finger while dragging; playback position otherwise. */
  const [scrub, setScrub] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const duration = status.duration > 0 ? status.duration : recording.durationSeconds;
  const position = Math.min(duration, scrub ?? status.currentTime);
  const ready = status.isLoaded && !pending;

  const seek = async (seconds: number) => {
    setError(null);
    try { await player.seekTo(Math.max(0, Math.min(duration, seconds))); }
    catch { if (mounted.current) setError('This recording could not be moved to that point.'); }
  };
  const togglePlayback = async () => {
    setError(null);
    if (status.playing) { player.pause(); return; }
    setPending(true);
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (!mounted.current) return;
      if (status.didJustFinish || status.currentTime >= duration) await player.seekTo(0);
      if (mounted.current) player.play();
    } catch {
      if (mounted.current) setError('This recording could not be played.');
    } finally { if (mounted.current) setPending(false); }
  };
  const failed = error ?? (status.playbackState === 'failed' ? 'This recording could not be loaded.' : null);

  return (
    <View className="gap-1">
      <View className="gap-1">
        <Slider value={position} minValue={0} maxValue={Math.max(duration, 0.1)} step={0.1} isDisabled={!status.isLoaded}
          aria-label="Playback position" onChange={value => setScrub(value as number)}
          onChangeEnd={value => { setScrub(null); void seek(value as number); }}>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <View className="flex-row justify-between">
          <AppText className="text-xs text-muted">{clock(position)}</AppText>
          <AppText className="text-xs text-muted">-{clock(Math.max(0, duration - position))}</AppText>
        </View>
      </View>
      <View className="flex-row items-center justify-center gap-6">
        <Button isIconOnly variant="ghost" isDisabled={!ready} accessibilityLabel={`Back ${SKIP_SECONDS} seconds`}
          onPress={() => void seek(status.currentTime - SKIP_SECONDS)}>
          <MaterialIcons name="replay-5" size={24} color={foreground} />
        </Button>
        <Button isIconOnly className="h-12 w-12 rounded-full bg-foreground" isDisabled={!ready}
          accessibilityLabel={status.playing ? 'Pause' : 'Play'} onPress={() => void togglePlayback()}>
          <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color={background} style={status.playing ? undefined : { marginLeft: 2 }} />
        </Button>
        <Button isIconOnly variant="ghost" isDisabled={!ready} accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
          onPress={() => void seek(status.currentTime + SKIP_SECONDS)}>
          <MaterialIcons name="forward-5" size={24} color={foreground} />
        </Button>
      </View>
      {failed && <AppText className="text-xs text-danger">{failed}</AppText>}
    </View>
  );
}
