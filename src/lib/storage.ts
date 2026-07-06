import type { ChannelConfig, SavedChannelState } from '../types';

const LAST_CONFIG_KEY = 'simple-stream-roulette:last-config:v2';

const emptyState = (): SavedChannelState => ({
  version: 1,
  items: [],
  donationLogs: [],
  processedDonationIds: [],
  updatedAt: Date.now(),
});

function channelStorageKey(config: Pick<ChannelConfig, 'platform' | 'channelId'>): string {
  return `simple-stream-roulette:${config.platform}:${config.channelId.trim()}:v2`;
}

export function loadLastConfig(): ChannelConfig {
  try {
    const raw = localStorage.getItem(LAST_CONFIG_KEY);
    if (!raw) return { platform: 'chzzk', channelId: '', voteUnitPrice: 1000 };
    const value = JSON.parse(raw) as Partial<ChannelConfig>;
    return {
      platform: value.platform === 'soop' ? 'soop' : 'chzzk',
      channelId: typeof value.channelId === 'string' ? value.channelId : '',
      voteUnitPrice: Number(value.voteUnitPrice) > 0 ? Math.floor(Number(value.voteUnitPrice)) : 1000,
    };
  } catch {
    return { platform: 'chzzk', channelId: '', voteUnitPrice: 1000 };
  }
}

export function saveLastConfig(config: ChannelConfig): void {
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

export function saveChannelState(config: ChannelConfig, state: SavedChannelState): void {
  if (!config.channelId.trim()) return;
  localStorage.setItem(channelStorageKey(config), JSON.stringify(state));
}

export function clearChannelState(config: ChannelConfig): void {
  if (!config.channelId.trim()) return;
  localStorage.removeItem(channelStorageKey(config));
}
