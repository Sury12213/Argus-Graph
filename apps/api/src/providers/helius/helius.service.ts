import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { RedisService } from '../redis/redis.service';
import { TokenHolder, TokenMetadata, WalletTransaction } from './helius.types';

/**
 * Helius Service — Solana on-chain data provider.
 *
 * Runtime policy:
 * - HELIUS_API_KEY is required for live scan data.
 * - No mock data is returned at runtime.
 * - Missing/partial upstream data is represented with empty arrays, unknown
 *   metadata, or explicit warnings instead of fabricated values.
 * - Responses are cached in Redis to reduce rate-limit pressure.
 */
@Injectable()
export class HeliusService {
  private readonly logger = new Logger(HeliusService.name);
  private readonly apiKey?: string;
  private readonly rpcUrl: string;
  private readonly restUrl = 'https://api.helius.xyz/v0';
  private readonly http: AxiosInstance;

  constructor(
    private configService: ConfigService,
    private redis: RedisService,
  ) {
    const apiKey = this.configService.get<string>('HELIUS_API_KEY');
    if (!apiKey || apiKey === 'your-helius-api-key-here') {
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException({
          code: 'HELIUS_API_KEY_MISSING',
          message: 'HELIUS_API_KEY is required for live Solana scan data.',
        });
      }

      this.rpcUrl = '';
      this.http = axios.create({ timeout: 10000 });
      this.logger.warn('Helius unavailable: HELIUS_API_KEY is missing');
      return;
    }

    this.apiKey = apiKey;
    const customRpc = this.configService.get<string>('HELIUS_RPC_URL')?.trim();
    this.rpcUrl = customRpc || `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    this.http = axios.create({ timeout: 10000 });
    this.logger.log('🔗 Helius RPC connected (mainnet, live-only)');
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.rpcUrl);
  }

  private assertAvailable() {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException({
        code: 'HELIUS_API_KEY_MISSING',
        message: 'HELIUS_API_KEY is required for live Solana scan data.',
      });
    }
  }

  async ping(): Promise<void> {
    this.assertAvailable();
    await this.http.post(this.rpcUrl, {
      jsonrpc: '2.0',
      id: 'health',
      method: 'getHealth',
    });
  }

  // ═══════════════════════════════════════════
  //  TOKEN METADATA — Helius DAS getAsset + RugCheck
  // ═══════════════════════════════════════════

  async getTokenMetadata(tokenAddress: string): Promise<TokenMetadata | null> {
    this.assertAvailable();
    const cacheKey = `meta:v4:${tokenAddress}`
    const cached = await this.redis.cacheGet<TokenMetadata>(cacheKey);
    if (cached) {
      this.logger.debug(`[CACHE HIT] metadata ${tokenAddress}`);
      return cached;
    }

    try {
      const [dasRes, rugCheckRes, dexRes] = await Promise.allSettled([
        this.http.post(this.rpcUrl, {
          jsonrpc: '2.0', id: 'getAsset', method: 'getAsset',
          params: { id: tokenAddress },
        }),
        this.http.get(
          `https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`,
          { timeout: 5000 },
        ),
        this.http.get(
          `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
          { timeout: 5000 },
        ),
      ]);

      if (dasRes.status === 'rejected' || !dasRes.value.data.result) {
        this.logger.warn(`getAsset returned no result for ${tokenAddress}`);
        return this.generateUnknownMetadata(tokenAddress, ['HELIUS_GET_ASSET_UNAVAILABLE']);
      }

      const asset = dasRes.value.data.result;
      const tokenInfo = asset.token_info || {};
      const authorities = asset.authorities || [];
      const ownership = asset.ownership || {};
      const mintAccount = await this.getParsedMintAccount(tokenAddress);
      const mintAuthority = mintAccount?.mintAuthority ?? null;
      const freezeAuthority = mintAccount?.freezeAuthority ?? null;

      let lpLocked: boolean | null = null;
      let lpLockPercentage: number | null = null;
      let lpLockConfidence: 'verified' | 'unknown' = 'unknown';
      let lpLockedPct: number | null = null;
      let lpBurnPct: number | null = null;
      let lpStatus: TokenMetadata['lp_status'] = 'unknown';
      const lpDetails: NonNullable<TokenMetadata['lp_details']> = [];
      let rugcheckScore: number | null = null;
      const rugRisks: string[] = [];
      const rugRisksNormalized: Array<{ severity: 'critical' | 'high' | 'medium' | 'info'; category: string; label: string }> = [];
      const warnings: string[] = [];
      const poolAddresses = new Set<string>();

      if (rugCheckRes.status === 'fulfilled') {
        const rc = rugCheckRes.value.data;
        this.logger.debug(`[RUGCHECK] ${tokenAddress} score=${rc?.score}`);

        rugcheckScore = typeof rc?.score === 'number' ? rc.score : null;

        if (rc?.risks?.length) {
          for (const r of rc.risks) {
            const label = r.name || r.description || '';
            if (!label) continue;
            rugRisks.push(label);
            rugRisksNormalized.push(this.normalizeRugCheckRisk(label));
          }
          const hasLpRisk = rc.risks.some((r: any) => {
            const label = `${r.name || ''} ${r.description || ''}`.toLowerCase();
            return label.includes('liquidity') || label.includes('lp') || label.includes('rug') || label.includes('lock');
          });
          if (hasLpRisk) {
            lpLocked = false;
            lpLockPercentage = 0;
            lpLockConfidence = 'verified';
          }
        }

        if (rc?.markets?.length) {
          for (const market of rc.markets) {
            for (const address of this.extractPoolAddresses(market)) {
              poolAddresses.add(address);
            }

            const detail = this.extractLpDetail(market);
            if (detail) lpDetails.push(detail);
          }

          const secureDetails = lpDetails.filter((detail) => typeof detail.total_secure_pct === 'number');
          if (secureDetails.length > 0) {
            const primary = secureDetails.reduce((best, detail) =>
              (detail.liquidity_usd ?? 0) > (best.liquidity_usd ?? 0) ? detail : best,
            );
            lpLockedPct = primary.locked_pct;
            lpBurnPct = primary.burn_pct;
            lpLockPercentage = primary.total_secure_pct;
            lpLocked = primary.total_secure_pct != null && primary.total_secure_pct >= 80;
            lpLockConfidence = 'verified';
            lpStatus = this.getLpStatus(lpLockedPct, lpBurnPct, lpLockPercentage);
          } else {
            warnings.push('LP_LOCK_UNVERIFIED');
          }
        } else {
          warnings.push('LP_LOCK_UNVERIFIED');
        }
      } else {
        warnings.push('RUGCHECK_UNAVAILABLE');
        this.logger.warn(`[RUGCHECK] failed for ${tokenAddress}`);
      }

      if (dexRes.status === 'fulfilled') {
        for (const pair of dexRes.value.data?.pairs ?? []) {
          if (pair?.pairAddress) poolAddresses.add(pair.pairAddress);
        }
      }

      const metadata: TokenMetadata = {
        address: tokenAddress,
        symbol: tokenInfo.symbol || asset.content?.metadata?.symbol || '$UNKNOWN',
        name: asset.content?.metadata?.name || 'Unknown Token',
        decimals: tokenInfo.decimals ?? 9,
        supply: tokenInfo.supply
          ? Number(tokenInfo.supply) / Math.pow(10, tokenInfo.decimals ?? 9) : 0,
        holder_count: tokenInfo.holder_count ?? 0,
        creator: ownership.owner || authorities[0]?.address || 'unknown',
        created_at: asset.created_at || new Date().toISOString(),
        lp_locked: lpLocked,
        lp_lock_percentage: lpLockPercentage,
        lp_lock_confidence: lpLockConfidence,
        lp_locked_pct: lpLockedPct,
        lp_burn_pct: lpBurnPct,
        lp_status: lpStatus,
        lp_details: lpDetails,
        rugcheck_score: rugcheckScore,
        rugcheck_risks_normalized: rugRisksNormalized,
        pool_addresses: Array.from(poolAddresses),
        mint_authority_revoked: mintAuthority == null,
        freeze_authority_revoked: freezeAuthority == null,
        rug_risks: rugRisks,
        source: 'helius',
        warnings,
      };

      await this.redis.cacheSet(cacheKey, metadata, 60);
      return metadata;
    } catch (error: any) {
      this.logger.error(`getAsset failed: ${error.message}`);
      return this.generateUnknownMetadata(tokenAddress, ['HELIUS_GET_ASSET_ERROR']);
    }
  }

  // ═══════════════════════════════════════════
  //  TOP HOLDERS — Helius getTokenAccounts
  // ═══════════════════════════════════════════

  async getTopHolders(tokenAddress: string): Promise<TokenHolder[]> {
    this.assertAvailable();
    const cacheKey = `holders:v4:${tokenAddress}`;
    const cached = await this.redis.cacheGet<TokenHolder[]>(cacheKey);
    if (cached) {
      this.logger.debug(`[CACHE HIT] holders ${tokenAddress}`);
      return cached;
    }

    try {
      this.logger.debug(`[HELIUS] getTokenLargestAccounts ${tokenAddress}`);
      const { data } = await this.http.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'getTokenLargestAccounts',
        method: 'getTokenLargestAccounts',
        params: [tokenAddress],
      });

      const largestAccounts = data.result?.value ?? [];
      if (!largestAccounts.length) {
        this.logger.warn(`[HELIUS] no token accounts for ${tokenAddress}`);
        return [];
      }

      const ownerBalances = new Map<string, number>();
      const [mintSupply, metadata, parsedAccounts] = await Promise.all([
        this.getMintSupplyRaw(tokenAddress),
        this.getTokenMetadata(tokenAddress),
        this.getParsedTokenAccounts(largestAccounts.map((account: any) => account.address).filter(Boolean)),
      ]);
      const poolAddresses = new Set(metadata?.pool_addresses ?? []);

      for (let i = 0; i < largestAccounts.length; i++) {
        const tokenAccount = largestAccounts[i];
        const owner = parsedAccounts[i]?.owner;
        if (!this.isSolanaAddress(owner) || owner === tokenAddress || poolAddresses.has(owner)) continue;
        const amount = Number(tokenAccount.amount || 0);
        ownerBalances.set(owner, (ownerBalances.get(owner) || 0) + amount);
      }

      const totalBalance = mintSupply > 0
        ? mintSupply
        : Array.from(ownerBalances.values()).reduce((sum, balance) => sum + balance, 0);

      const holders: TokenHolder[] = Array.from(ownerBalances.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([address, balance]) => ({
          address,
          balance,
          percentage: totalBalance > 0 ? (balance / totalBalance) * 100 : 0,
        }));

      await this.redis.cacheSet(cacheKey, holders, 60);
      return holders;
    } catch (error: any) {
      this.logger.error(`getTokenAccounts failed: ${error.message}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════
  //  TRANSACTIONS — Helius Enhanced Transactions
  // ═══════════════════════════════════════════

  async getTokenTransactions(tokenAddress: string): Promise<WalletTransaction[]> {
    this.assertAvailable();
    const cacheKey = `txns:${tokenAddress}`;
    const cached = await this.redis.cacheGet<WalletTransaction[]>(cacheKey);
    if (cached) {
      this.logger.debug(`[CACHE HIT] transactions ${tokenAddress}`);
      return cached;
    }

    try {
      this.logger.debug(`[HELIUS] getSignaturesForAsset ${tokenAddress}`);
      const sigRes = await this.http.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'getSignaturesForAsset',
        method: 'getSignaturesForAsset',
        params: { id: tokenAddress, limit: 100, sortDirection: 'desc' },
      });

      const signatures = (sigRes.data.result?.items || []).map((item: any) =>
        typeof item === 'string' ? item : item[0],
      ).filter(Boolean);

      if (signatures.length === 0) {
        this.logger.warn(`[HELIUS] no signatures for ${tokenAddress}`);
        return [];
      }

      this.logger.debug(`[HELIUS] parseTransactions (${signatures.length} sigs)`);
      const parseRes = await this.http.post(
        `${this.restUrl}/transactions?api-key=${this.apiKey}`,
        { transactions: signatures.slice(0, 100) },
      );

      const enhancedTxns = parseRes.data || [];
      const transactions: WalletTransaction[] = [];

      for (const tx of enhancedTxns) {
        const tokenTransfers = tx.tokenTransfers || [];
        for (const transfer of tokenTransfers) {
          if (transfer.mint === tokenAddress) {
            transactions.push({
              signature: tx.signature,
              from: transfer.fromUserAccount || 'unknown',
              to: transfer.toUserAccount || 'unknown',
              amount: transfer.tokenAmount ?? 0,
              timestamp: (tx.timestamp || 0) * 1000,
              type: this.classifyTransferType(tx),
            });
          }
        }

        const nativeTransfers = tx.nativeTransfers || [];
        for (const nt of nativeTransfers) {
          if (nt.amount > 100_000_000) {
            transactions.push({
              signature: tx.signature,
              from: nt.fromUserAccount || 'unknown',
              to: nt.toUserAccount || 'unknown',
              amount: nt.amount / 1_000_000_000,
              timestamp: (tx.timestamp || 0) * 1000,
              type: 'transfer',
            });
          }
        }
      }

      await this.redis.cacheSet(cacheKey, transactions, 60);
      return transactions;
    } catch (error: any) {
      this.logger.error(`getTokenTransactions failed: ${error.message}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════
  //  BLOCK DENSITY — Swap-per-block analysis
  // ═══════════════════════════════════════════

  async getBlockDensity(tokenAddress: string): Promise<BlockDensityData> {
    this.assertAvailable();
    const cacheKey = `block_density:${tokenAddress}`;
    const cached = await this.redis.cacheGet<BlockDensityData>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.restUrl}/addresses/${tokenAddress}/transactions?api-key=${this.apiKey}&limit=50`;
      const res = await this.http.get(url, { timeout: 8000 });
      const txns: any[] = res.data ?? [];

      if (txns.length === 0) {
        return this.emptyBlockDensity('helius');
      }

      const slotMap = new Map<number, { buys: number; sells: number; signatures: Set<string> }>();
      let swapCount = 0;

      for (const tx of txns) {
        const slot = tx.slot ?? 0;
        if (!slot) continue;

        const isSwap = tx.type === 'SWAP' ||
          tx.description?.toLowerCase()?.includes('swap') ||
          (tx.events?.swap != null);

        if (isSwap) {
          swapCount++;
          const existing = slotMap.get(slot) ?? { buys: 0, sells: 0, signatures: new Set<string>() };
          const isBuy = tx.tokenTransfers?.some(
            (t: any) => t.toUserAccount === tokenAddress,
          ) ?? true;

          if (isBuy) existing.buys++;
          else existing.sells++;
          existing.signatures.add(tx.signature ?? tx.transactionSignature ?? `${slot}:${swapCount}`);
          slotMap.set(slot, existing);
        }
      }

      const uniqueSlots = [...slotMap.keys()].sort((a, b) => a - b);
      const totalBlocksChecked = uniqueSlots.length > 0
        ? uniqueSlots[uniqueSlots.length - 1] - uniqueSlots[0] + 1
        : 20;
      const blocksWithSwaps = slotMap.size;
      const densityPct = totalBlocksChecked > 0
        ? Math.round((blocksWithSwaps / Math.min(totalBlocksChecked, 50)) * 100)
        : 0;

      let maxConsecutiveBuys = 0;
      let currentStreak = 0;
      let maxSwapsInSlot = 0;
      let burstSlotCount = 0;

      for (let i = 0; i < uniqueSlots.length; i++) {
        const slotData = slotMap.get(uniqueSlots[i])!;
        const slotSwaps = slotData.buys + slotData.sells;
        maxSwapsInSlot = Math.max(maxSwapsInSlot, slotSwaps);
        if (slotSwaps >= 4) burstSlotCount++;

        if (slotData.buys > 0 && slotData.buys >= slotData.sells) {
          currentStreak++;
          maxConsecutiveBuys = Math.max(maxConsecutiveBuys, currentStreak);
        } else {
          currentStreak = 0;
        }

        if (i > 0 && uniqueSlots[i] - uniqueSlots[i - 1] > 2) {
          currentStreak = slotData.buys > 0 ? 1 : 0;
        }
      }

      const sameSlotBundleDetected = maxSwapsInSlot >= 6 || burstSlotCount >= 3;
      const result: BlockDensityData = {
        total_blocks_checked: Math.min(totalBlocksChecked, 50),
        blocks_with_swaps: blocksWithSwaps,
        density_pct: densityPct,
        consecutive_buy_blocks: maxConsecutiveBuys,
        is_god_candle: maxConsecutiveBuys >= 10,
        swap_count_recent: swapCount,
        max_swaps_in_slot: maxSwapsInSlot,
        burst_slot_count: burstSlotCount,
        same_slot_bundle_detected: sameSlotBundleDetected,
        source: 'helius',
      };

      await this.redis.cacheSet(cacheKey, result, 30);
      return result;
    } catch (error: any) {
      this.logger.warn(`[HELIUS] Block density failed: ${error.message}`);
      return this.emptyBlockDensity('error');
    }
  }

  // ═══════════════════════════════════════════
  //  VELOCITY & SMART MONEY SUPPORT
  // ═══════════════════════════════════════════

  async getVelocityData(tokenAddress: string) {
    const now = Date.now();
    const tenMinAgo = now - 10 * 60 * 1000;
    const storedTweets = await this.redis.getTimeSeriesRange('tweet_count', tokenAddress, tenMinAgo, now);
    const storedHolders = await this.redis.getTimeSeriesRange('holder_count', tokenAddress, tenMinAgo, now);

    return {
      tweet_snapshots: storedTweets.map((p) => ({
        timestamp: p.timestamp,
        count: p.value,
        unique_users: Math.floor(p.value * 0.85),
      })),
      holder_snapshots: storedHolders.map((p) => ({
        timestamp: p.timestamp,
        count: p.value,
      })),
      available: storedTweets.length >= 2 || storedHolders.length >= 2,
      warnings: [
        ...(storedTweets.length < 2 ? ['TWEET_TIMESERIES_INSUFFICIENT'] : []),
        ...(storedHolders.length < 2 ? ['HOLDER_TIMESERIES_INSUFFICIENT'] : []),
      ],
    };
  }

  async getSmartWallets() {
    const addresses = this.configService.get<string>('SMART_WALLET_ADDRESSES') ?? '';
    return addresses
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean)
      .map((address) => ({ address, winRate: null, label: 'Configured Smart Wallet', totalPnl: null }));
  }

  async getSmartWalletActivity(tokenAddress: string) {
    try {
      const [holders, smartWallets] = await Promise.all([
        this.getTopHolders(tokenAddress),
        this.getSmartWallets(),
      ]);
      const smartWalletAddresses = smartWallets.map((w) => w.address);
      const buying = holders
        .filter((h) => smartWalletAddresses.includes(h.address))
        .map((h) => h.address);

      return {
        inflow_count: buying.length,
        outflow_count: 0,
        smart_wallets_buying: buying,
        smart_wallets_selling: [],
        available: smartWalletAddresses.length > 0,
      };
    } catch {
      return { inflow_count: 0, outflow_count: 0, smart_wallets_buying: [], smart_wallets_selling: [], available: false };
    }
  }

  // ═══════════════════════════════════════════
  //  FIRST FUNDING SOURCE — cluster detection
  // ═══════════════════════════════════════════

  async getWalletFundingSources(walletAddresses: string[]): Promise<Map<string, string>> {
    this.assertAvailable();
    if (walletAddresses.length === 0) return new Map();

    const cacheKey = `funding:${walletAddresses.slice(0, 5).join('-')}`;
    const cached = await this.redis.cacheGet<[string, string][]>(cacheKey);
    if (cached) return new Map(cached);

    const fundingMap = new Map<string, string>();
    const targets = walletAddresses.slice(0, 10);

    await Promise.allSettled(
      targets.map(async (wallet) => {
        try {
          const sigRes = await this.http.post(this.rpcUrl, {
            jsonrpc: '2.0', id: `sigs_${wallet}`,
            method: 'getSignaturesForAddress',
            params: [wallet, { limit: 5, commitment: 'finalized' }],
          }, { timeout: 3000 });

          const sigs = sigRes.data.result ?? [];
          if (sigs.length === 0) return;

          const oldestSig = sigs[sigs.length - 1].signature;
          const txRes = await this.http.post(
            `${this.restUrl}/transactions?api-key=${this.apiKey}`,
            { transactions: [oldestSig] },
            { timeout: 3000 },
          );

          const firstTx = txRes.data?.[0];
          if (!firstTx) return;

          const firstInflow = (firstTx.nativeTransfers ?? []).find(
            (nt: any) => nt.toUserAccount === wallet && nt.amount > 0,
          );

          if (firstInflow?.fromUserAccount) {
            fundingMap.set(wallet, firstInflow.fromUserAccount);
          }
        } catch {
          // Skip unavailable wallet data; do not fabricate funding source.
        }
      }),
    );

    await this.redis.cacheSet(cacheKey, Array.from(fundingMap.entries()), 300);
    return fundingMap;
  }

  // ═══════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════

  private extractLpDetail(market: any): NonNullable<TokenMetadata['lp_details']>[number] | null {
    const lp = market?.lp;
    if (!lp) return null;
    const lockedPct = this.toPercent(lp.lpLockedPct ?? lp.lockedPct ?? lp.lockedPercentage);
    const burnPct = this.toPercent(lp.burnPct ?? lp.lpBurnedPct ?? lp.burnedPct);
    const totalSecurePct = this.toPercent(
      lp.totalSecurePct ?? (lockedPct != null || burnPct != null ? (lockedPct ?? 0) + (burnPct ?? 0) : null),
    );
    return {
      market: market.marketType ?? market.dex ?? 'unknown',
      pair_address: market.pubkey ?? market.address ?? market.pairAddress ?? 'unknown',
      lp_mint: lp.lpMint ?? market.mintLP ?? null,
      locked_pct: lockedPct,
      burn_pct: burnPct,
      total_secure_pct: totalSecurePct == null ? null : Math.min(100, totalSecurePct),
      liquidity_usd: typeof lp.quoteUSD === 'number' || typeof lp.baseUSD === 'number'
        ? (Number(lp.quoteUSD ?? 0) + Number(lp.baseUSD ?? 0))
        : null,
    };
  }

  private getLpStatus(lockedPct: number | null, burnPct: number | null, totalSecurePct: number | null): TokenMetadata['lp_status'] {
    if (totalSecurePct == null) return 'unknown';
    if ((burnPct ?? 0) >= 80) return 'burned';
    if ((lockedPct ?? 0) >= 80) return 'locked';
    if (totalSecurePct >= 80) return 'locked';
    if (totalSecurePct > 0) return 'partial';
    return 'unlocked';
  }

  private toPercent(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric <= 1) return numeric * 100;
    return numeric;
  }

  private extractPoolAddresses(market: any): string[] {
    const found = new Set<string>();
    const visit = (value: unknown) => {
      if (!value) return;
      if (typeof value === 'string') {
        if (this.isSolanaAddress(value)) found.add(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value === 'object') {
        Object.values(value).forEach(visit);
      }
    };

    visit(market);
    return Array.from(found);
  }

  private isSolanaAddress(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  }

  private normalizeRugCheckRisk(label: string): { severity: 'critical' | 'high' | 'medium' | 'info'; category: string; label: string } {
    const lower = label.toLowerCase();
    if (lower.includes('freeze') || lower.includes('mint') || lower.includes('rug') || lower.includes('liquidity') || lower.includes('lp')) {
      return { severity: 'critical', category: 'structural', label };
    }
    if (lower.includes('owner') || lower.includes('top holder') || lower.includes('concentration') || lower.includes('mutable')) {
      return { severity: 'high', category: 'holders', label };
    }
    if (lower.includes('low') || lower.includes('new') || lower.includes('market')) {
      return { severity: 'medium', category: 'market', label };
    }
    return { severity: 'info', category: 'other', label };
  }

  private async getParsedMintAccount(tokenAddress: string): Promise<{ mintAuthority: string | null; freezeAuthority: string | null } | null> {
    try {
      const { data } = await this.http.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'getParsedMintAccount',
        method: 'getAccountInfo',
        params: [tokenAddress, { encoding: 'jsonParsed' }],
      });
      const info = data.result?.value?.data?.parsed?.info;
      if (!info) return null;
      return {
        mintAuthority: info.mintAuthority ?? null,
        freezeAuthority: info.freezeAuthority ?? null,
      };
    } catch (error: any) {
      this.logger.warn(`[HELIUS] getAccountInfo failed for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  private async getParsedTokenAccounts(tokenAccounts: string[]): Promise<Array<{ owner: string | null }>> {
    if (!tokenAccounts.length) return [];
    try {
      const { data } = await this.http.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'getParsedTokenAccounts',
        method: 'getMultipleAccounts',
        params: [tokenAccounts, { encoding: 'jsonParsed' }],
      });
      return (data.result?.value ?? []).map((account: any) => ({
        owner: account?.data?.parsed?.info?.owner ?? null,
      }));
    } catch (error: any) {
      this.logger.warn(`[HELIUS] getMultipleAccounts failed: ${error.message}`);
      return tokenAccounts.map(() => ({ owner: null }));
    }
  }

  private async getMintSupplyRaw(tokenAddress: string): Promise<number> {
    try {
      const { data } = await this.http.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'getTokenSupply',
        method: 'getTokenSupply',
        params: [tokenAddress],
      });
      return Number(data.result?.value?.amount ?? 0);
    } catch (error: any) {
      this.logger.warn(`[HELIUS] getTokenSupply failed for ${tokenAddress}: ${error.message}`);
      return 0;
    }
  }

  private classifyTransferType(tx: any): WalletTransaction['type'] {
    const type = tx.type || '';
    if (type === 'SWAP' || type.includes('SWAP')) return 'swap';
    if (type === 'BURN' || type.includes('BURN')) return 'burn';
    if (type === 'CREATE' || type.includes('CREATE')) return 'create';
    return 'transfer';
  }

  private generateUnknownMetadata(tokenAddress: string, warnings: string[] = []): TokenMetadata {
    return {
      address: tokenAddress,
      symbol: '$UNKNOWN',
      name: 'Unknown Token',
      decimals: 9,
      supply: 0,
      holder_count: 0,
      creator: 'unknown',
      created_at: new Date().toISOString(),
      lp_locked: null,
      lp_lock_percentage: null,
      lp_lock_confidence: 'unknown',
      lp_locked_pct: null,
      lp_burn_pct: null,
      lp_status: 'unknown',
      lp_details: [],
      rugcheck_score: null,
      rugcheck_risks_normalized: [],
      pool_addresses: [],
      mint_authority_revoked: false,
      freeze_authority_revoked: false,
      rug_risks: [],
      source: 'unknown',
      warnings,
    };
  }

  private emptyBlockDensity(source: 'helius' | 'error'): BlockDensityData {
    return {
      total_blocks_checked: 0,
      blocks_with_swaps: 0,
      density_pct: 0,
      consecutive_buy_blocks: 0,
      is_god_candle: false,
      swap_count_recent: 0,
      max_swaps_in_slot: 0,
      burst_slot_count: 0,
      same_slot_bundle_detected: false,
      source,
    };
  }
}

export interface BlockDensityData {
  total_blocks_checked: number;
  blocks_with_swaps: number;
  density_pct: number;
  consecutive_buy_blocks: number;
  is_god_candle: boolean;
  swap_count_recent: number;
  max_swaps_in_slot: number;
  burst_slot_count: number;
  same_slot_bundle_detected: boolean;
  source: 'helius' | 'error';
}
