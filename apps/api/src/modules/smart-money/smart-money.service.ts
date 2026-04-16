import { Injectable, Logger } from '@nestjs/common';
import { HeliusService } from '../../providers/helius/helius.service';

/**
 * 💎 Smart Money Layer — Alpha Wallet Tracking
 *
 * Tracks high win-rate wallets ("Smart Money") and their activity on tokens.
 * Signals:
 *   - Multiple smart wallets buying → Positive (lower risk)
 *   - Smart wallets exiting → Negative (higher risk)
 *
 * Output: smart_money score (0-100, higher = riskier / less smart money interest)
 */
@Injectable()
export class SmartMoneyService {
  private readonly logger = new Logger(SmartMoneyService.name);

  constructor(private helius: HeliusService) {}

  async analyze(tokenAddress: string): Promise<SmartMoneyAnalysisResult> {
    this.logger.debug(`Analyzing smart money for ${tokenAddress}`);

    const [smartWallets, activity] = await Promise.all([
      this.helius.getSmartWallets(),
      this.helius.getSmartWalletActivity(tokenAddress),
    ]);

    // Calculate smart money score
    const score = this.calculateScore(activity, smartWallets.length);

    return {
      smart_money_score: Math.min(100, Math.max(0, score)),
      inflow_count: activity.inflow_count,
      outflow_count: activity.outflow_count,
      smart_wallets_buying: activity.smart_wallets_buying,
      smart_wallets_selling: activity.smart_wallets_selling,
      total_tracked_wallets: smartWallets.length,
    };
  }

  private calculateScore(
    activity: any,
    totalTracked: number,
  ): number {
    // Base: 50 (neutral)
    let score = 50;

    // Smart money buying = LOWER risk (subtract from score)
    score -= activity.inflow_count * 15;

    // Smart money selling = HIGHER risk (add to score)
    score += activity.outflow_count * 20;

    // No smart money interest at all = slightly higher risk
    if (activity.inflow_count === 0 && activity.outflow_count === 0) {
      score += 10;
    }

    return Math.round(score);
  }
}

export interface SmartMoneyAnalysisResult {
  smart_money_score: number;
  inflow_count: number;
  outflow_count: number;
  smart_wallets_buying: string[];
  smart_wallets_selling: string[];
  total_tracked_wallets: number;
}
