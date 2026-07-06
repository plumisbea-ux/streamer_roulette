import type { ChannelConfig, SavedChannelState } from '../types';

const LAST_CONFIG_KEY = 'stream-roulette:last-config:v1';
const API_KEY_KEY = 'stream-roulette:ssapi-api-key:v1';

const emptyState = (): SavedChannelState => ({
  version: 1,
  items: [],
  donationLogs: [],
  processedDonationIds: [],
  updatedAt: Date.now(),
});

export function channelStorageKey(config: Pick<ChannelConfig, 'platform' | 'channelId'>) {
  return `stream-roulette:channel:${config.platform}:${config.channelId.trim()}:v1`;
}

export function loadLastConfig(): ChannelConfig {
  try {
    const raw = localStorage.getItem(LAST_CONFIG_KEY);
    if (!raw) return { platform: 'chzzk', channelId: '', displayName: '', imageUrl: '', voteUnitPrice: 1000 };
    const value = JSON.parse(raw) as Partial<ChannelConfig>;
    return {
      platform: value.platform === 'soop' ? 'soop' : 'chzzk',
      channelId: typeof value.channelId === 'string' ? value.channelId : '',
      displayName: typeof value.displayName === 'string' ? value.displayName : '',
      imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : '',
      voteUnitPrice: Number.isFinite(value.voteUnitPrice) && Number(value.voteUnitPrice) > 0 ? Number(value.voteUnitPrice) : 1000,
    };
  } catch {
    return { platform: 'chzzk', channelId: '', displayName: '', imageUrl: '', voteUnitPrice: 1000 };
  }
}

export function saveLastConfig(config: ChannelConfig) {
  localStorage.setItem(LAST_CONFIG_KEY, JSON.stringify(config));
}

export function loadChannelState(config: ChannelConfig): SavedChannelState {
  if (!config.channelId.trim()) return emptyState();
  try {
    const raw = localStorage.getItem(channelStorageKey(config));
    if (!raw) return emptyState();
    const value = JSON.parse(raw) as Partial<SavedChannelState>;
    return {
      version: 1,
      items: Array.isArray(value.items) ? value.items : [],
      donationLogs: Array.isArray(value.donationLogs) ? value.donationLogs : [],
      processedDonationIds: Array.isArray(value.processedDonationIds) ? value.processedDonationIds : [],
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    };
  } catch {
    return emptyState();
  }
}

export function saveChannelState(config: ChannelConfig, state: SavedChannelState) {
  if (!config.channelId.trim()) return;
  localStorage.setItem(channelStorageKey(config), JSON.stringify(state));
}

export function clearChannelState(config: ChannelConfig) {
  if (!config.channelId.trim()) return;
  localStorage.removeItem(channelStorageKey(config));
}

export function loadSavedApiKey() {
  return localStorage.getItem(API_KEY_KEY) ?? '';
}

export function saveApiKey(apiKey: string) {
  localStorage.setItem(API_KEY_KEY, apiKey);
}

export function removeSavedApiKey() {
  localStorage.removeItem(API_KEY_KEY);
}
