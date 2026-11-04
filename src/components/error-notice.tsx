import { useEffect } from 'react';
import { Alert } from 'react-native';
import { usePocket } from '@/contexts/pocket-context';

/** Shows Pocket errors as one native alert; mounted once at the root so tabs don't duplicate it. */
export function ErrorAlert() {
  const { error, clearError } = usePocket();
  useEffect(() => {
    if (!error) return;
    Alert.alert('Connection needs attention', error, [{ text: 'OK', onPress: clearError }], { cancelable: false });
  }, [error, clearError]);
  return null;
}
