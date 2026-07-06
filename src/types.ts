export type Platform = 'chzzk' | 'soop';

export type ChannelConfig = {
  platform: Platform;
  channelId: string;
  voteUnitPrice: number;
};

export type RouletteItem = {
  id: string;
  label: string;
  votes: number;
  createdAt: number;
  updatedAt: number;
};

export type DonationLog = {
  id: string;
  nickname: string;
  message: string;
  amount: number;
  addedVotes: number;
  receivedAt: number;
  source: 'donation' | 'manual';
};

export type SavedChannelState = {
  version: 1;
  items: RouletteItem[];
  donationLogs: DonationLog[];
  processedDonationIds: string[];
  updatedAt: number;
};

export type ConnectionStatus = 'idle' | 'connecting' | 'reading' | 'error';

export type SSAPIDonation = {
  _id?: string;
  platform?: string;
  streamer_id?: string;
  nickname?: string;
  message?: string;
  amount?: number;
};
