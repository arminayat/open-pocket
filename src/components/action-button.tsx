import { Button, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';

type Props = Pick<React.ComponentProps<typeof Button>, 'onPress' | 'isDisabled' | 'accessibilityLiveRegion'> & {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
};

/** The recording page's small secondary action: an icon and a short label. */
export function ActionButton({ icon, label, ...props }: Props) {
  const color = useThemeColor('accent-soft-foreground');
  return (
    <Button size="sm" variant="secondary" {...props}>
      <Ionicons name={icon} size={16} color={color} />
      <Button.Label>{label}</Button.Label>
    </Button>
  );
}
