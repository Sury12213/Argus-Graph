import { Injectable, Logger } from '@nestjs/common';
import {
  MOCK_TOKENS,
  MOCK_WALLET_TRANSACTIONS,
  MOCK_TOP_HOLDERS,
  MOCK_VELOCITY_DATA,
  MOCK_SMART_WALLETS,
  TokenMetadata,
  WalletTransaction,
  TokenHolder,
} from './mock-data';

/**
 * Helius Service — Solana on-chain data provider.
 *
 * Currently uses mock data for development.
 * Will be replaced with real Helius RPC calls in Phase 2.
 */
@Injectable()
export class HeliusService {
  private readonly logger = new Logger(HeliusService.name);

  /**
   * Get token metadata (supply, holders, LP lock status, etc.)
   */
  async getTokenMetadata(tokenAddress: string): Promise<TokenMetadata | null> {
    this.logger.debug(`[MOCK] Fetching metadata for ${tokenAddress}`);

    // Simulate network latency
    await this.simulateLatency();

    return MOCK_TOKENS[tokenAddress] ?? this.generateDefaultMock(tokenAddress);
  }

  /**
   * Get transaction history for a token (transfers, swaps).
   * Used by Cluster Engine to build wallet graph.
   */
  async getTokenTransactions(tokenAddress: string): Promise<WalletTransaction[]> {
    this.logger.debug(`[MOCK] Fetching transactions for ${tokenAddress}`);
    await this.simulateLatency();

    return MOCK_WALLET_TRANSACTIONS[tokenAddress] ?? [];
  }

  /**
   * Get top holders of a token.
   * Used by Cluster Engine and Smart Money.
   */
  async getTopHolders(tokenAddress: string): Promise<TokenHolder[]> {
    this.logger.debug(`[MOCK] Fetching top holders for ${tokenAddress}`);
    await this.simulateLatency();

    return MOCK_TOP_HOLDERS[tokenAddress] ?? [];
  }

  /**
   * Get velocity snapshot data (tweet counts, holder counts over time).
   */
  async getVelocityData(tokenAddress: string) {
    this.logger.debug(`[MOCK] Fetching velocity data for ${tokenAddress}`);
    await this.simulateLatency();

    return MOCK_VELOCITY_DATA[tokenAddress] ?? {
      tweet_snapshots: [],
      holder_snapshots: [],
    };
  }

  /**
   * Get known smart wallets.
   */
  async getSmartWallets() {
    this.logger.debug('[MOCK] Fetching smart wallets');
    await this.simulateLatency();
    return MOCK_SMART_WALLETS;
  }

  /**
   * Check if smart wallets have recent activity on a token.
   */
  async getSmartWalletActivity(tokenAddress: string) {
    this.logger.debug(`[MOCK] Checking smart wallet activity for ${tokenAddress}`);
    await this.simulateLatency();

    // Mock: smart wallets bought SafeToken, avoided ScamToken
    if (tokenAddress === 'SafeToken222222222222222222222222222222222') {
      return {
        inflow_count: 2,
        outflow_count: 0,
        smart_wallets_buying: ['SmartWhale_01', 'SmartSniper_01'],
        smart_wallets_selling: [],
      };
    }
    return {
      inflow_count: 0,
      outflow_count: 1,
      smart_wallets_buying: [],
      smart_wallets_selling: ['SmartWhale_02'],
    };
  }

  // ── Helpers ──

  private generateDefaultMock(tokenAddress: string): TokenMetadata {
    return {
      address: tokenAddress,
      symbol: '$UNKNOWN',
      name: 'Unknown Token',
      decimals: 9,
      supply: 1_000_000_000,
      holder_count: Math.floor(Math.random() * 500) + 10,
      creator: 'UnknownCreator',
      created_at: new Date().toISOString(),
      lp_locked: Math.random() > 0.5,
      lp_lock_percentage: Math.floor(Math.random() * 100),
      mint_authority_revoked: Math.random() > 0.5,
      freeze_authority_revoked: Math.random() > 0.5,
    };
  }

  private simulateLatency(): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(resolve, 50 + Math.random() * 100),
    );
  }
}
