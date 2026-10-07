import { useEffect, useRef, useState } from 'react';
import { Button, Card } from 'heroui-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { LocalRecording } from '@/lib/pocket/types';
import { AppText } from './screen';

function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }

export function RecordingPlayer({ recording }: { recording: LocalRecording }) {
  const player = useAudioPlayer(recording.uri);
  const status = useAudioPlayerStatus(player);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const togglePlayback = async () => {
    setError(null);
    if (status.playing) { player.pause(); return; }
    setPending(true);
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (!mounted.current) return;
      if (status.didJustFinish) await player.seekTo(0);
      if (mounted.current) player.play();
    } catch {
      if (mounted.current) setError('This recording could not be played. Try downloading it again.');
    } finally { if (mounted.current) setPending(false); }
  };
  return (
    <Card className="bg-surface-secondary">
      <Card.Body className="gap-3">
        <Card.Title>Now playing</Card.Title>
        <Card.Description>{recording.date} · {recording.timestamp} · {recording.transport === 'wifi' ? 'Wi-Fi' : 'Bluetooth'}</Card.Description>
        <AppText className="text-sm">{clock(status.currentTime)} / {clock(status.duration)}</AppText>
        {(error || status.playbackState === 'failed') && <AppText className="text-sm text-danger">{error ?? 'This recording could not be loaded. Try downloading it again.'}</AppText>}
        <Button variant="secondary" isDisabled={pending || !status.isLoaded} onPress={() => void togglePlayback()}>{status.playing ? 'Pause' : !status.isLoaded ? 'Loading recording…' : 'Play recording'}</Button>
      </Card.Body>
    </Card>
  );
}
