export type AiProviderId = 'chatgpt' | 'openai' | 'anthropic' | 'openrouter';
/** Providers whose credential is an API key saved in this app's Keychain record. */
export type AiKeyProviderId = Exclude<AiProviderId, 'chatgpt'>;

export interface AiModelChoice { id: string; label: string; note?: string }

export interface AiProvider {
  id: AiProviderId;
  name: string;
  /** Recommended model, used until the user chooses another or the provider lists its own. */
  model: string;
  /** Documented models offered before the live list loads or when it cannot be read. */
  models: AiModelChoice[];
  description: string;
  billing: string;
  apiKeyUrl?: string;
  pricingUrl: string;
  privacyUrl: string;
}

export const AI_PROVIDERS: readonly AiProvider[] = [
  {
    id: 'chatgpt', name: 'ChatGPT', model: 'gpt-6.1-sol',
    models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
    description: 'Use your ChatGPT sign-in. No API key needed.',
    billing: 'Uses your ChatGPT plan’s included usage and limits.',
    pricingUrl: 'https://chatgpt.com/pricing', privacyUrl: 'https://developers.openai.com/siwc/token-sharing-open-source',
  },
  {
    id: 'openai', name: 'OpenAI', model: 'gpt-6-luna',
    models: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'Cheapest' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'Best quality for the price' },
    ],
    description: 'Your own OpenAI API key. Requests are not stored by OpenAI for later use.',
    billing: 'Billed to your OpenAI API account, separately from ChatGPT.',
    apiKeyUrl: 'https://platform.openai.com/api-keys', pricingUrl: 'https://openai.com/api/pricing/',
    privacyUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  },
  {
    id: 'anthropic', name: 'Claude', model: 'claude-haiku-5-5',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fast and cheap' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Higher quality' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable' },
    ],
    description: 'Your own Anthropic API key, scoped to a workspace. Content is not retained by default.',
    billing: 'Billed to your Anthropic API account, separately from a Claude subscription.',
    apiKeyUrl: 'https://platform.claude.com/settings/keys', pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    privacyUrl: 'https://platform.claude.com/docs/en/manage-claude/api-and-data-retention',
  },
  {
    id: 'openrouter', name: 'OpenRouter', model: 'openai/gpt-oss-120b',
    models: [{ id: 'openai/gpt-oss-120b', label: 'gpt-oss-120b', note: 'Low cost' }],
    description: 'Many models with one account. OpenPocket only routes to providers with zero data retention.',
    billing: 'Billed to your OpenRouter credits.',
    apiKeyUrl: 'https://openrouter.ai/settings/keys', pricingUrl: 'https://openrouter.ai/models',
    privacyUrl: 'https://openrouter.ai/docs/guides/features/zdr',
  },
];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && AI_PROVIDERS.some(provider => provider.id === value);
}

export function getAiProvider(id: AiProviderId): AiProvider {
  const provider = AI_PROVIDERS.find(item => item.id === id);
  if (!provider) throw new Error('Unknown AI provider.');
  return provider;
}

/** Model IDs only enter JSON bodies; OpenRouter IDs contain `/` and `:free`-style variants. */
export function validAiModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(value);
}

export function resolveAiModel(provider: AiProviderId, chosen: string | undefined): string {
  return validAiModelId(chosen) ? chosen : getAiProvider(provider).model;
}
