export interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: number;
  holder_count: number;
  creator: string;
  created_at: string;
  lp_locked: boolean | null;
  lp_lock_percentage: number | null;
  lp_lock_confidence?: 'verified' | 'unknown';
  lp_locked_pct?: number | null;
  lp_burn_pct?: number | null;
  lp_status?: 'locked' | 'burned' | 'partial' | 'unlocked' | 'unknown';
  lp_details?: Array<{
    market: string;
    pair_address: string;
    lp_mint?: string | null;
    locked_pct: number | null;
    burn_pct: number | null;
    total_secure_pct: number | null;
    liquidity_usd?: number | null;
  }>;
  rugcheck_score?: number | null;
  rugcheck_risks_normalized?: Array<{ severity: 'critical' | 'high' | 'medium' | 'info'; category: string; label: string }>;
  mint_authority_revoked: boolean;
  freeze_authority_revoked: boolean;
  rug_risks?: string[];
  pool_addresses?: string[];
  source?: 'helius' | 'rugcheck' | 'unknown';
  warnings?: string[];
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
