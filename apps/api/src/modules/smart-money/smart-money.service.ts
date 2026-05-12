import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeliusService } from '../../providers/helius/helius.service';
import { PrismaService } from '../../providers/prisma/prisma.service';

/**
 * Smart Money Engine v2 — Actionable Alpha Signals
 *
 * Answers whether high-conviction wallets are accumulating or distributing this token.
 *
 * Signals produced:
 *   1. NET_FLOW_SIGNAL  — Whale net buy/sell volume last 100 txns
 *   2. ALPHA_WALLET_HIT — Known alpha wallets detected as holders
 *   3. STEALTH_ACCUMULATION — Many small wallets coordinating (anti-obfuscation)
 *   4. DEV_DUMP_RISK    — Creator/team wallets reducing position
 *   5. WHALE_EXIT       — Large holder significantly reducing holdings
 *
 * Output: score 0-100 (higher = riskier)
 */
@Injectable()
export class SmartMoneyService {
  private readonly logger = new Logger(SmartMoneyService.name);

  constructor(
    private helius: HeliusService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async analyze(tokenAddress: string): Promise<SmartMoneyAnalysisResult> {
    this.logger.debug(`[SmartMoney] Analyzing ${tokenAddress}`);

    const [topHolders, metadata, transactions] = await Promise.all([
      this.helius.getTopHolders(tokenAddress),
      this.helius.getTokenMetadata(tokenAddress),
      this.helius.getTokenTransactions(tokenAddress),
    ]);

    const traderHolders = this.filterPoolHolders(topHolders, metadata);
    const smartWallets = await this.prisma.smartWallet.findMany({
      where: { address: { in: traderHolders.map((holder) => holder.address) } },
      select: { address: true, winRate: true, label: true, totalPnl: true, tradeCount: true, metadata: true },
    });

    // ── Signal 1: Net Flow from top holders cross-referenced with transactions
    const netFlow = this.analyzeNetFlow(traderHolders, transactions);

    // ── Signal 2: Alpha Wallet detection
    const alphaSignal = this.detectAlphaWallets(traderHolders, smartWallets, netFlow.wallet_flows);

    // ── Signal 3: Stealth accumulation (many similar-sized wallets)
    const stealthSignal = this.detectStealthAccumulation(traderHolders);

    // ── Signal 4: Dev dump risk
    const devRisk = this.analyzeDevRisk(traderHolders, metadata, transactions);

    // ── Signal 5: Concentration & distribution
    const commonHolderAllowlist = this.getCommonHolderAllowlist();
    const concentration = this.analyzeConcentration(traderHolders, commonHolderAllowlist);

    // ── Final score
    const score = this.calculateScore(netFlow, alphaSignal, stealthSignal, devRisk, concentration, metadata);
    const finalScore = Math.min(100, Math.max(0, score));

    // ── Determine signal label
    const signal = this.computeSignal(netFlow, alphaSignal, finalScore);

    return {
      smart_money_score: finalScore,
      signal,
      // Net flow (key signal)
      net_flow_pct: netFlow.net_flow_pct,
      net_flow_direction: netFlow.direction,
      whale_buy_txns: netFlow.buy_count,
      whale_sell_txns: netFlow.sell_count,
      // Alpha wallets
      alpha_wallets_holding: alphaSignal.found,
      alpha_wallet_addresses: alphaSignal.addresses,
      alpha_wallet_quality_score: alphaSignal.quality_score,
      alpha_wallet_accumulating_score: alphaSignal.accumulating_score,
      alpha_wallet_selling_score: alphaSignal.selling_score,
      alpha_wallet_details: alphaSignal.wallets.map((wallet) => ({
        address: wallet.address,
        label: wallet.label,
        winRate: wallet.winRate,
        totalPnl: wallet.totalPnl,
        tradeCount: wallet.tradeCount,
        holding_pct: Number(wallet.holding_pct.toFixed(2)),
        net_flow: wallet.net_flow,
        quality: wallet.quality,
        direction: wallet.direction,
      })),
      // Stealth detection
      stealth_accumulation: stealthSignal.detected,
      coordinated_wallets: stealthSignal.count,
      // Dev risk
      dev_holding_pct: devRisk.dev_pct,
      dev_net_sold_pct: devRisk.sold_pct,
      dev_dump_detected: devRisk.dump_detected,
      // Concentration
      whale_concentration: concentration.top5_pct,
      distribution_grade: concentration.grade,
      // Wallet activity feed
      whale_activity: netFlow.activity_feed,
      // Legacy fields for compatibility
      inflow_count: netFlow.buy_count,
      outflow_count: netFlow.sell_count,
      smart_wallets_buying: alphaSignal.addresses,
      smart_wallets_selling: devRisk.dump_detected ? [metadata?.creator ?? ''] : [],
      total_tracked_wallets: traderHolders.length,
      top_holders_detail: traderHolders.slice(0, 5).map((h) => ({
        address: h.address,
        percentage: Number(h.percentage.toFixed(2)),
        label: this.labelHolder(h, metadata, alphaSignal.addresses, commonHolderAllowlist),
        is_alpha: alphaSignal.addresses.includes(h.address),
        net_flow: netFlow.wallet_flows.get(h.address) ?? 0,
      })),
    };
  }

  private filterPoolHolders(holders: any[], metadata: any) {
    const poolAddresses = new Set<string>(metadata?.pool_addresses ?? []);
    return holders.filter((holder) => !this.isPoolHolder(holder, poolAddresses));
  }

  private isPoolHolder(holder: any, poolAddresses: Set<string>): boolean {
    if (poolAddresses.has(holder.address)) return true;
    const text = `${holder.address ?? ''} ${holder.label ?? ''} ${holder.name ?? ''} ${holder.type ?? ''}`.toLowerCase();
    return text.includes('ammpool') || text.includes('amm pool') || text.includes('lp pool') || text.includes('raydium');
  }

  // ── Signal 1: Net Flow ──────────────────────────────

  private analyzeNetFlow(holders: any[], transactions: any[]) {
    const holderSet = new Set(holders.slice(0, 20).map((h) => h.address));
    const walletFlows = new Map<string, number>();
    const activity: WhaleActivity[] = [];

    let buyVolume = 0;
    let sellVolume = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const tx of transactions) {
      // Whale is BUYING (receiving tokens)
      if (holderSet.has(tx.to) && tx.amount > 0) {
        walletFlows.set(tx.to, (walletFlows.get(tx.to) ?? 0) + tx.amount);
        buyVolume += tx.amount;
        buyCount++;
        if (activity.length < 10) {
          activity.push({
            wallet: tx.to.slice(0, 6) + '...' + tx.to.slice(-4),
            action: 'BUY',
            amount: tx.amount,
            timestamp: tx.timestamp,
          });
        }
      }

      // Whale is SELLING (sending tokens out)
      if (holderSet.has(tx.from) && tx.amount > 0) {
        walletFlows.set(tx.from, (walletFlows.get(tx.from) ?? 0) - tx.amount);
        sellVolume += tx.amount;
        sellCount++;
        if (activity.length < 10) {
          activity.push({
            wallet: tx.from.slice(0, 6) + '...' + tx.from.slice(-4),
            action: 'SELL',
            amount: tx.amount,
            timestamp: tx.timestamp,
          });
        }
      }
    }

    const totalVolume = buyVolume + sellVolume;
    const netFlowPct = totalVolume > 0
      ? ((buyVolume - sellVolume) / totalVolume) * 100
      : 0;

    const direction: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL' =
      netFlowPct > 20 ? 'ACCUMULATING' :
      netFlowPct < -20 ? 'DISTRIBUTING' : 'NEUTRAL';

    return {
      net_flow_pct: Number(netFlowPct.toFixed(1)),
      direction,
      buy_count: buyCount,
      sell_count: sellCount,
      activity_feed: activity.sort((a, b) => b.timestamp - a.timestamp),
      wallet_flows: walletFlows,
    };
  }

  // ── Signal 2: Alpha Wallet Detection ───────────────

  private detectAlphaWallets(holders: any[], smartWallets: SmartWalletSignal[], walletFlows: Map<string, number>) {
    const smartWalletMap = new Map(smartWallets.map((wallet) => [wallet.address, wallet]));
    const found = holders.filter((h) => smartWalletMap.has(h.address));
    const wallets = found.map((holder) => {
      const wallet = smartWalletMap.get(holder.address)!;
      const flow = walletFlows.get(holder.address) ?? 0;
      const quality = this.calculateWalletQuality(wallet);
      const direction: SmartWalletDirection =
        flow > 0 ? 'ACCUMULATING' :
        flow < 0 ? 'SELLING' :
        holder.percentage < 0.1 ? 'DUST' : 'HOLDING';
      return { ...wallet, holding_pct: holder.percentage, net_flow: flow, quality, direction };
    });
    const qualityScore = wallets.reduce((sum, wallet) => sum + wallet.quality * Math.min(1, wallet.holding_pct / 2), 0);
    const accumulatingScore = wallets
      .filter((wallet) => wallet.direction === 'ACCUMULATING' || wallet.direction === 'HOLDING')
      .reduce((sum, wallet) => sum + wallet.quality, 0);
    const sellingScore = wallets
      .filter((wallet) => wallet.direction === 'SELLING')
      .reduce((sum, wallet) => sum + wallet.quality, 0);

    return {
      found: wallets.length > 0,
      count: wallets.length,
      addresses: wallets.map((wallet) => wallet.address),
      total_pct: found.reduce((s, h) => s + h.percentage, 0),
      wallets,
      quality_score: Number(qualityScore.toFixed(1)),
      accumulating_score: Number(accumulatingScore.toFixed(1)),
      selling_score: Number(sellingScore.toFixed(1)),
    };
  }

  private calculateWalletQuality(wallet: SmartWalletSignal): number {
    const pnlScore = Math.min(25, Math.log10(Math.max(1, wallet.totalPnl ?? 0)) * 8);
    const tradeScore = Math.min(15, Math.log10(Math.max(1, wallet.tradeCount)) * 5);
    const winRateScore = Math.max(0, Math.min(45, wallet.winRate * 45));
    const metadata = wallet.metadata as { last_active?: number } | null;
    const lastActiveMs = typeof metadata?.last_active === 'number' ? metadata.last_active * 1000 : 0;
    const ageDays = lastActiveMs > 0 ? (Date.now() - lastActiveMs) / 86400000 : 999;
    const recencyScore = ageDays <= 7 ? 15 : ageDays <= 30 ? 8 : 0;
    return Math.round(Math.min(100, winRateScore + pnlScore + tradeScore + recencyScore));
  }

  // ── Signal 3: Stealth Accumulation ─────────────────

  private detectStealthAccumulation(holders: any[]) {
    // Many wallets holding between 0.5%–2% = coordinated wallet farm
    const suspiciousRange = holders.filter(
      (h) => h.percentage >= 0.5 && h.percentage <= 2.5,
    );

    // Check if they're suspiciously similar in size (within 0.3% of each other)
    let coordinated = 0;
    for (let i = 0; i < suspiciousRange.length; i++) {
      for (let j = i + 1; j < suspiciousRange.length; j++) {
        if (Math.abs(suspiciousRange[i].percentage - suspiciousRange[j].percentage) < 0.3) {
          coordinated++;
        }
      }
    }

    return {
      detected: coordinated >= 3,
      count: suspiciousRange.length,
      coordinated_pairs: coordinated,
    };
  }

  // ── Signal 4: Dev Dump Risk ─────────────────────────

  private analyzeDevRisk(holders: any[], metadata: any, transactions: any[]) {
    const creator = metadata?.creator;
    if (!creator || creator === 'unknown') {
      return { dev_pct: 0, sold_pct: 0, dump_detected: false };
    }

    const devHolder = holders.find((h) => h.address === creator);
    const devPct = devHolder?.percentage ?? 0;

    // Check if dev has been selling
    const devSells = transactions.filter((t) => t.from === creator);
    const devBuys = transactions.filter((t) => t.to === creator);
    const devSellVol = devSells.reduce((s, t) => s + t.amount, 0);
    const devBuyVol = devBuys.reduce((s, t) => s + t.amount, 0);
    const netSold = devSellVol - devBuyVol;
    const receivedOrHeld = Math.max(devBuyVol, devSellVol + (devHolder?.balance ?? 0), 1);

    return {
      dev_pct: Number(devPct.toFixed(2)),
      sold_pct: Number((netSold > 0 ? (netSold / receivedOrHeld) * 100 : 0).toFixed(1)),
      dump_detected: devSells.length > 3 && netSold > 0,
    };
  }

  // ── Signal 5: Concentration ─────────────────────────

  private analyzeConcentration(holders: any[], commonHolderAllowlist: Set<string>) {
    const nonLp = holders.filter((h) => h.percentage < 50 && !commonHolderAllowlist.has(h.address));
    const top5 = nonLp.slice(0, 5).reduce((s, h) => s + h.percentage, 0);
    const top1 = nonLp[0]?.percentage ?? 0;

    let grade: string;
    if (top1 > 40) grade = 'F';
    else if (top5 > 60) grade = 'D';
    else if (top5 > 40) grade = 'C';
    else if (top5 > 20) grade = 'B';
    else grade = 'A';

    return { top5_pct: Number(top5.toFixed(1)), top1_pct: Number(top1.toFixed(1)), grade };
  }

  // ── Score Calculation ────────────────────────────────

  private calculateScore(
    netFlow: ReturnType<SmartMoneyService['analyzeNetFlow']>,
    alpha: ReturnType<SmartMoneyService['detectAlphaWallets']>,
    stealth: ReturnType<SmartMoneyService['detectStealthAccumulation']>,
    dev: ReturnType<SmartMoneyService['analyzeDevRisk']>,
    conc: ReturnType<SmartMoneyService['analyzeConcentration']>,
    metadata: any,
  ): number {
    let score = 40;

    if (netFlow.direction === 'ACCUMULATING') score -= 15;
    else if (netFlow.direction === 'DISTRIBUTING') score += 25;

    if (alpha.selling_score > alpha.accumulating_score && alpha.selling_score >= 60) score += 20;
    else if (alpha.accumulating_score >= 120) score -= 20;
    else if (alpha.accumulating_score >= 60) score -= 12;
    else if (alpha.found) score -= 5;

    if (stealth.detected) score += 10;

    if (dev.dump_detected) score += 35;
    else if (dev.dev_pct > 15) score += 15;

    const gradeScore: Record<string, number> = { A: 0, B: 12, C: 22, D: 35, F: 45 };
    score += gradeScore[conc.grade] ?? 15;

    if (conc.top1_pct > 40) score = Math.max(score, 80);
    else if (conc.top1_pct > 20) score = Math.max(score, 65);
    else if (conc.top1_pct > 15) score = Math.max(score, 55);
    if (conc.top5_pct > 60) score = Math.max(score, 80);
    else if (conc.top5_pct > 40) score = Math.max(score, 70);
    else if (conc.top5_pct > 30) score = Math.max(score, 55);
    else if (conc.top5_pct > 20) score = Math.max(score, 45);

    const hasCriticalRisk = (metadata?.rugcheck_risks_normalized ?? [])
      .some((risk: any) => risk.severity === 'critical');
    if (
      metadata?.lp_locked === false ||
      metadata?.lp_locked == null ||
      metadata?.mint_authority_revoked === false ||
      metadata?.freeze_authority_revoked === false ||
      hasCriticalRisk
    ) {
      score = Math.max(score, 50);
    }

    return Math.round(score);
  }

  // ── Signal Label ─────────────────────────────────────

  private computeSignal(
    netFlow: ReturnType<SmartMoneyService['analyzeNetFlow']>,
    alpha: ReturnType<SmartMoneyService['detectAlphaWallets']>,
    finalScore: number,
  ): SmartMoneySignal {
    if (finalScore >= 65) return 'DISTRIBUTION_RISK';
    if (netFlow.direction === 'DISTRIBUTING') return 'DEV_OR_WHALE_EXIT_RISK';
    if (netFlow.direction === 'ACCUMULATING' && finalScore < 50) return 'ACCUMULATION_OBSERVED';
    if (alpha.found && finalScore < 50) return 'ACCUMULATION_OBSERVED';
    return 'NO_RELIABLE_SIGNAL';
  }

  // ── Label Helper ─────────────────────────────────────

  private getCommonHolderAllowlist(): Set<string> {
    const addresses = [
      this.config.get<string>('COMMON_HOLDER_ALLOWLIST') ?? '',
      this.config.get<string>('CLUSTER_COMMON_FUNDER_ALLOWLIST') ?? '',
    ].join(',');
    return new Set(addresses.split(',').map((address) => address.trim()).filter(Boolean));
  }

  private labelHolder(h: any, metadata: any, alphaAddresses: string[], commonHolderAllowlist: Set<string>): string {
    if (metadata?.creator && h.address === metadata.creator) return 'Creator';
    if (commonHolderAllowlist.has(h.address)) return 'CEX/Common Wallet';
    if (alphaAddresses.includes(h.address)) return 'Alpha Wallet';
    if (h.percentage > 30) return 'Mega Whale';
    if (h.percentage > 10) return 'Whale';
    if (h.percentage > 3) return 'Large Holder';
    return 'Holder';
  }
}

// ── Types ────────────────────────────────────────────────

interface WhaleActivity {
  wallet: string;
  action: 'BUY' | 'SELL';
  amount: number;
  timestamp: number;
}

type SmartWalletDirection = 'ACCUMULATING' | 'HOLDING' | 'SELLING' | 'DUST';

interface SmartWalletSignal {
  address: string;
  winRate: number;
  label: string | null;
  totalPnl: number | null;
  tradeCount: number;
  metadata: unknown;
}

export type SmartMoneySignal = 'ACCUMULATION_OBSERVED' | 'DISTRIBUTION_RISK' | 'DEV_OR_WHALE_EXIT_RISK' | 'NO_RELIABLE_SIGNAL';

export interface SmartMoneyAnalysisResult {
  smart_money_score: number;
  signal: SmartMoneySignal;
  // Net flow
  net_flow_pct: number;
  net_flow_direction: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
  whale_buy_txns: number;
  whale_sell_txns: number;
  // Alpha wallets
  alpha_wallets_holding: boolean;
  alpha_wallet_addresses: string[];
  alpha_wallet_quality_score: number;
  alpha_wallet_accumulating_score: number;
  alpha_wallet_selling_score: number;
  alpha_wallet_details: Array<{
    address: string;
    label: string | null;
    winRate: number;
    totalPnl: number | null;
    tradeCount: number;
    holding_pct: number;
    net_flow: number;
    quality: number;
    direction: SmartWalletDirection;
  }>;
  // Stealth
  stealth_accumulation: boolean;
  coordinated_wallets: number;
  // Dev
  dev_holding_pct: number;
  dev_net_sold_pct: number;
  dev_dump_detected: boolean;
  // Concentration
  whale_concentration: number;
  distribution_grade: string;
  // Activity feed
  whale_activity: WhaleActivity[];
  // Legacy
  inflow_count: number;
  outflow_count: number;
  smart_wallets_buying: string[];
  smart_wallets_selling: string[];
  total_tracked_wallets: number;
  top_holders_detail: Array<{
    address: string;
    percentage: number;
    label: string;
    is_alpha: boolean;
    net_flow: number;
  }>;
}
