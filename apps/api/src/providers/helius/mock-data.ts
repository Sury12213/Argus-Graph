// ============================================
// Helius Mock Data — Simulates Solana on-chain data
// Will be replaced by real Helius API in Phase 2
// ============================================

export interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: number;
  holder_count: number;
  creator: string;
  created_at: string;
  lp_locked: boolean;
  lp_lock_percentage: number;
  mint_authority_revoked: boolean;
  freeze_authority_revoked: boolean;
}

export interface WalletTransaction {
  signature: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: 'transfer' | 'swap' | 'create' | 'burn';
}

export interface TokenHolder {
  address: string;
  balance: number;
  percentage: number;
}

// ── Mock datasets ──

export const MOCK_TOKENS: Record<string, TokenMetadata> = {
  // Scam token — high risk
  'ScamToken111111111111111111111111111111111': {
    address: 'ScamToken111111111111111111111111111111111',
    symbol: '$RUGME',
    name: 'RugMe Token',
    decimals: 9,
    supply: 1_000_000_000,
    holder_count: 45,
    creator: 'DevWallet9999999999999999999999999999999999',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    lp_locked: false,
    lp_lock_percentage: 0,
    mint_authority_revoked: false,
    freeze_authority_revoked: false,
  },

  // Legit token — low risk
  'SafeToken222222222222222222222222222222222': {
    address: 'SafeToken222222222222222222222222222222222',
    symbol: '$SAFU',
    name: 'SafuCoin',
    decimals: 9,
    supply: 500_000_000,
    holder_count: 12500,
    creator: 'LegitDev33333333333333333333333333333333',
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    lp_locked: true,
    lp_lock_percentage: 95,
    mint_authority_revoked: true,
    freeze_authority_revoked: true,
  },

  // Medium risk token
  'MidToken3333333333333333333333333333333333': {
    address: 'MidToken3333333333333333333333333333333333',
    symbol: '$HMMMM',
    name: 'Suspicious Meme',
    decimals: 9,
    supply: 750_000_000,
    holder_count: 890,
    creator: 'UnknownDev444444444444444444444444444444',
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5h ago
    lp_locked: true,
    lp_lock_percentage: 60,
    mint_authority_revoked: true,
    freeze_authority_revoked: false,
  },
};

export const MOCK_WALLET_TRANSACTIONS: Record<string, WalletTransaction[]> = {
  // Scam token — circular trading cluster
  'ScamToken111111111111111111111111111111111': [
    { signature: 'sig1', from: 'DevWallet9999999999999999999999999999999999', to: 'ClusterA_01', amount: 50_000_000, timestamp: Date.now() - 7200000, type: 'transfer' },
    { signature: 'sig2', from: 'DevWallet9999999999999999999999999999999999', to: 'ClusterA_02', amount: 50_000_000, timestamp: Date.now() - 7100000, type: 'transfer' },
    { signature: 'sig3', from: 'DevWallet9999999999999999999999999999999999', to: 'ClusterA_03', amount: 50_000_000, timestamp: Date.now() - 7000000, type: 'transfer' },
    { signature: 'sig4', from: 'ClusterA_01', to: 'ClusterA_02', amount: 25_000_000, timestamp: Date.now() - 6500000, type: 'transfer' },
    { signature: 'sig5', from: 'ClusterA_02', to: 'ClusterA_03', amount: 25_000_000, timestamp: Date.now() - 6000000, type: 'transfer' },
    { signature: 'sig6', from: 'ClusterA_03', to: 'ClusterA_01', amount: 25_000_000, timestamp: Date.now() - 5500000, type: 'swap' },
    // More cluster wallets from same source
    ...Array.from({ length: 12 }, (_, i) => ({
      signature: `sig_cluster_${i}`,
      from: 'DevWallet9999999999999999999999999999999999',
      to: `ClusterA_${String(i + 4).padStart(2, '0')}`,
      amount: 10_000_000 + Math.random() * 5_000_000,
      timestamp: Date.now() - (5000000 - i * 100000),
      type: 'transfer' as const,
    })),
  ],

  // Safe token — organic distribution
  'SafeToken222222222222222222222222222222222': [
    { signature: 'safe1', from: 'LegitDev33333333333333333333333333333333', to: 'Raydium_LP_Pool', amount: 250_000_000, timestamp: Date.now() - 2592000000, type: 'transfer' },
    { signature: 'safe2', from: 'Organic_Buyer_01', to: 'Organic_Buyer_01', amount: 5_000, timestamp: Date.now() - 86400000, type: 'swap' },
    { signature: 'safe3', from: 'Organic_Buyer_02', to: 'Organic_Buyer_02', amount: 12_000, timestamp: Date.now() - 43200000, type: 'swap' },
  ],
};

export const MOCK_TOP_HOLDERS: Record<string, TokenHolder[]> = {
  'ScamToken111111111111111111111111111111111': [
    { address: 'DevWallet9999999999999999999999999999999999', balance: 400_000_000, percentage: 40.0 },
    { address: 'ClusterA_01', balance: 75_000_000, percentage: 7.5 },
    { address: 'ClusterA_02', balance: 75_000_000, percentage: 7.5 },
    { address: 'ClusterA_03', balance: 75_000_000, percentage: 7.5 },
    { address: 'ClusterA_04', balance: 50_000_000, percentage: 5.0 },
  ],
  'SafeToken222222222222222222222222222222222': [
    { address: 'Raydium_LP_Pool', balance: 250_000_000, percentage: 50.0 },
    { address: 'LegitDev33333333333333333333333333333333', balance: 25_000_000, percentage: 5.0 },
    { address: 'Organic_Buyer_01', balance: 5_000, percentage: 0.001 },
  ],
};

// Smart wallets mock
export const MOCK_SMART_WALLETS = [
  { address: 'SmartWhale_01', winRate: 0.85, label: 'Whale', totalPnl: 1250.5 },
  { address: 'SmartWhale_02', winRate: 0.78, label: 'Early Bird', totalPnl: 890.2 },
  { address: 'SmartSniper_01', winRate: 0.92, label: 'Sniper', totalPnl: 2100.0 },
];

// Velocity mock data (tweet count & holder count snapshots)
export const MOCK_VELOCITY_DATA: Record<string, { tweet_snapshots: { timestamp: number; count: number; unique_users: number }[]; holder_snapshots: { timestamp: number; count: number }[] }> = {
  'ScamToken111111111111111111111111111111111': {
    tweet_snapshots: [
      { timestamp: Date.now() - 600000, count: 50, unique_users: 12 },
      { timestamp: Date.now() - 300000, count: 180, unique_users: 14 },  // 260% spike, but only 2 new users → BOT
      { timestamp: Date.now(), count: 350, unique_users: 15 },
    ],
    holder_snapshots: [
      { timestamp: Date.now() - 600000, count: 40 },
      { timestamp: Date.now() - 300000, count: 42 },
      { timestamp: Date.now(), count: 45 },  // Holder barely growing
    ],
  },
  'SafeToken222222222222222222222222222222222': {
    tweet_snapshots: [
      { timestamp: Date.now() - 600000, count: 2000, unique_users: 1800 },
      { timestamp: Date.now() - 300000, count: 2150, unique_users: 1950 },
      { timestamp: Date.now(), count: 2300, unique_users: 2100 },
    ],
    holder_snapshots: [
      { timestamp: Date.now() - 600000, count: 12000 },
      { timestamp: Date.now() - 300000, count: 12250 },
      { timestamp: Date.now(), count: 12500 },
    ],
  },
};
