import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, Input, ListGroup, Separator, TextField, useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './screen';

/** An iOS-style grouped section: small uppercase header, optional intro, content and footer. */
export function Section({ title, intro, footer, action, children }:
  { title: string; intro?: string; footer?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <View className="min-h-6 flex-row items-center justify-between px-1">
        <AppText accessibilityRole="header" className="text-xs uppercase tracking-wide text-muted">{title}</AppText>
        {action}
      </View>
      {intro && <AppText className="px-1 text-sm leading-5 text-muted">{intro}</AppText>}
      {children}
      {footer && <AppText className="px-1 text-xs leading-5 text-muted">{footer}</AppText>}
    </View>
  );
}

export interface Choice { id: string; title: string; description?: string }

const SEARCH_AFTER = 12;
const SEARCH_LIMIT = 30;

/** A single-choice ListGroup with a checkmark; long lists get a search field and show the best matches. */
export function ChoiceList({ items, selected, disabled, onSelect, label }:
  { items: Choice[]; selected: string | undefined; disabled?: boolean; onSelect(id: string): void; label: string }) {
  const accent = useThemeColor('accent');
  const [query, setQuery] = useState('');
  const searchable = items.length > SEARCH_AFTER;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = searchable ? items.filter(item => words.every(word => `${item.title} ${item.id}`.toLowerCase().includes(word))) : items;
  // Keep the current choice visible above the matches.
  const current = items.find(item => item.id === selected);
  const shown = searchable
    ? [...(current && !words.length ? [current] : []), ...matches.filter(item => words.length || item.id !== selected)].slice(0, SEARCH_LIMIT)
    : items;
  return <>
    {searchable && <TextField>
      <Input value={query} onChangeText={setQuery} placeholder={`Search ${items.length} ${label}`} accessibilityLabel={`Search ${label}`}
        autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
    </TextField>}
    {shown.length ? <ListGroup>
      {shown.map((item, index) => {
        const active = item.id === selected;
        return <View key={item.id}>
          {index > 0 && <Separator className="mx-4" />}
          <ListGroup.Item disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: active, disabled }}
            onPress={() => onSelect(item.id)}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{item.title}</ListGroup.ItemTitle>
              {item.description && <ListGroup.ItemDescription>{item.description}</ListGroup.ItemDescription>}
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              {active ? <Ionicons name="checkmark" size={20} color={accent} /> : <View className="w-5" />}
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        </View>;
      })}
    </ListGroup> : <AppText className="px-1 text-sm text-muted">No {label} match “{query.trim()}”.</AppText>}
    {searchable && matches.length > SEARCH_LIMIT && <AppText className="px-1 text-xs text-muted">Showing {SEARCH_LIMIT} of {matches.length}. Search to narrow the list.</AppText>}
  </>;
}

/** Saved state with Replace/Remove, otherwise a secure field. Callers own validation and storage. */
export function ApiKeyCard({ name, saved, disabled, onSave, onRemove, children }: {
  name: string; saved: boolean; disabled: boolean; onSave(key: string): Promise<boolean>; onRemove(): void; children?: React.ReactNode;
}) {
  const success = useThemeColor('success');
  const [editing, setEditing] = useState(!saved);
  const [key, setKey] = useState('');
  const save = async () => { if (await onSave(key)) { setKey(''); setEditing(false); } };
  if (saved && !editing) {
    return (
      <Card><Card.Body className="gap-3">
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={20} color={success} />
          <AppText className="flex-1">API key saved</AppText>
        </View>
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" isDisabled={disabled} onPress={() => setEditing(true)}>Replace</Button>
          <Button size="sm" variant="danger-soft" isDisabled={disabled} onPress={onRemove}>Remove</Button>
        </View>
      </Card.Body></Card>
    );
  }
  return (
    <Card><Card.Body className="gap-3">
      {children}
      <TextField isDisabled={disabled}>
        <Input value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false}
          textContentType="none" placeholder={`${name} API key`} accessibilityLabel={`${name} API key`}
          returnKeyType="done" onSubmitEditing={() => { if (key.trim()) void save(); }} />
      </TextField>
      <View className="flex-row gap-2">
        <Button size="sm" variant="primary" isDisabled={disabled || !key.trim()} onPress={() => void save()}>Save key</Button>
        {saved && <Button size="sm" variant="ghost" isDisabled={disabled} onPress={() => { setKey(''); setEditing(false); }}>Cancel</Button>}
      </View>
    </Card.Body></Card>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** External account pages (keys, pricing, privacy) as link rows. */
export function LinkRows({ name, links }: { name: string; links: { label: string; icon: IconName; url: string }[] }) {
  const muted = useThemeColor('muted');
  const [linkError, setLinkError] = useState<string | null>(null);
  const open = async (url: string) => {
    setLinkError(null);
    try { await Linking.openURL(url); }
    catch { setLinkError(`Could not open ${name}’s website. Please try again.`); }
  };
  return <>
    <ListGroup>
      {links.map((link, index) => <View key={link.label}>
        {index > 0 && <Separator className="mx-4" />}
        <ListGroup.Item accessibilityRole="link" onPress={() => void open(link.url)}>
          <ListGroup.ItemPrefix><Ionicons name={link.icon} size={20} color={muted} /></ListGroup.ItemPrefix>
          <ListGroup.ItemContent><ListGroup.ItemTitle>{link.label}</ListGroup.ItemTitle></ListGroup.ItemContent>
          <ListGroup.ItemSuffix><Ionicons name="open-outline" size={16} color={muted} /></ListGroup.ItemSuffix>
        </ListGroup.Item>
      </View>)}
    </ListGroup>
    {linkError && <AppText className="px-1 text-sm text-danger" accessibilityRole="alert">{linkError}</AppText>}
  </>;
}

/** An inline error with Dismiss, shown above a settings page's sections. */
export function ErrorRow({ message, onDismiss }: { message: string; onDismiss(): void }) {
  return (
    <View className="flex-row items-start gap-2">
      <AppText className="flex-1 text-sm text-danger" accessibilityRole="alert">{message}</AppText>
      <Button size="sm" variant="ghost" className="-mr-3 -mt-1.5" onPress={onDismiss}>Dismiss</Button>
    </View>
  );
}
