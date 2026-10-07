import { Button, Card } from 'heroui-native';
import { usePocket } from '@/contexts/pocket-context';

export function ErrorNotice() {
  const { error, clearError } = usePocket();
  if (!error) return null;
  return (
    <Card className="bg-danger-soft" accessibilityLiveRegion="polite">
      <Card.Body className="gap-2">
        <Card.Title>Connection needs attention</Card.Title>
        <Card.Description>{error}</Card.Description>
        <Button variant="ghost" size="sm" onPress={clearError}>Dismiss</Button>
      </Card.Body>
    </Card>
  );
}
