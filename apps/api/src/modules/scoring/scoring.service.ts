import { Injectable } from '@nestjs/common';

/**
 * Scoring Engine v3.2 — Availability-aware Dynamic Weights
 *
 * Formula changes based on market_mode:
 *   HYPE:   Velocity↑ (0.4) + SmartMoney↑ (0.25), OnChain↓ (0.1)
 *   FEAR:   ClusterRisk↑ (0.4) + OnChain↑ (0.25), Velocity↓ (0.15)
 *   NORMAL: Cluster(0.3) + Velocity(0.3) + Smart(0.2) + OnChain(0.2)
 *
 * Production policy:
 * - Missing modules are not fabricated.
 * - Available module weights are normalized.
 * - Confidence reflects total original weight coverage.
 */
@Injectable()
export class ScoringService {
  private static readonly WEIGHTS = {
    NORMAL: { cluster_risk: 0.30, velocity_score: 0.30, smart_money: 0.20, basic_onchain: 0.20 },
    HYPE:   { cluster_risk: 0.25, velocity_score: 0.40, smart_money: 0.25, basic_onchain: 0.10 },
    FEAR:   { cluster_risk: 0.40, velocity_score: 0.15, smart_money: 0.20, basic_onchain: 0.25 },
  } as const;

  calculateFinalScore(input: ScoringInput): ScoringResult {
    const mode = input.market_mode ?? 'NORMAL';
    const baseWeights = ScoringService.WEIGHTS[mode];
    const modules: ScoringModuleKey[] = ['cluster_risk', 'velocity_score', 'smart_money', 'basic_onchain'];

    const availableModules = modules.filter((key) => this.isAvailableScore(input[key]));
    const availableWeight = availableModules.reduce((sum, key) => sum + baseWeights[key], 0);
    const confidence = Math.round(availableWeight * 100) / 100;
    const warnings = modules
      .filter((key) => !availableModules.includes(key))
      .map((key) => `${key.toUpperCase()}_UNAVAILABLE_REWEIGHTED`);

    if (availableWeight === 0) {
      return {
        final_score: 100,
        risk_level: 'CRITICAL',
        market_mode: mode,
        is_degen_play: false,
        confidence: 0,
        warnings: ['NO_SCORING_MODULES_AVAILABLE'],
        breakdown: this.buildEmptyBreakdown(input, baseWeights),
        weights: { ...baseWeights },
      };
    }

    let rawScore = 0;
    const breakdown: Partial<ScoringResult['breakdown']> = {};

    for (const key of modules) {
      const score = input[key];
      const available = this.isAvailableScore(score);
      const normalizedWeight = available ? baseWeights[key] / availableWeight : 0;
      const contribution = available ? (score as number) * normalizedWeight : 0;

      rawScore += contribution;
      breakdown[key] = {
        score: available ? score as number : null,
        weight: normalizedWeight,
        base_weight: baseWeights[key],
        contribution,
        available,
      };
    }

    const onchainScore = this.isAvailableScore(input.basic_onchain) ? input.basic_onchain as number : null;
    const scoreFloor = this.calculateScoreFloor(input, onchainScore);
    const finalScore = Math.min(100, Math.max(scoreFloor, Math.round(rawScore * 10) / 10));
    const velocityScore = this.isAvailableScore(input.velocity_score) ? input.velocity_score as number : 100;
    const smartMoneyScore = this.isAvailableScore(input.smart_money) ? input.smart_money as number : 100;

    const isDegenPlay =
      finalScore >= 50 &&
      velocityScore < 30 &&
      smartMoneyScore < 40 &&
      input.degen_signals?.hype_detected === true;

    return {
      final_score: finalScore,
      risk_level: this.getRiskLevel(finalScore),
      market_mode: mode,
      is_degen_play: isDegenPlay,
      confidence,
      warnings,
      breakdown: breakdown as ScoringResult['breakdown'],
      weights: { ...baseWeights },
    };
  }

  calculateTraderScore(input: ScoringInput): TraderScoringResult {
    const context = input.risk_context;
    const velocity = input.velocity_context;
    const smart = input.smart_money_context;

    const lpUnknownRisk = context?.lp_locked == null || context?.lp_lock_confidence === 'unknown'
      ? context?.is_pumpfun_token && context?.pump_is_graduated === false
        ? 5
        : (context?.dex_pool_count ?? 0) > 0 ? 35 : 45
      : 0;
    const rugRisk = this.clamp(Math.max(
      input.basic_onchain ?? 50,
      context?.lp_locked === false ? 90 : 0,
      lpUnknownRisk,
      context?.freeze_authority_revoked === false ? 85 : 0,
      context?.mint_authority_revoked === false ? 75 : 0,
      (context?.rugcheck_critical_count ?? 0) > 0 ? 90 : 0,
    ));

    const dumpRisk = this.clamp(Math.max(
      input.smart_money ?? 50,
      context?.dev_dump_detected ? 85 : 0,
      smart?.net_flow_direction === 'DISTRIBUTING' ? 75 : 0,
      (smart?.alpha_wallet_selling_score ?? 0) >= 60 ? 70 : 0,
      typeof context?.price_change_h1 === 'number' && context.price_change_h1 <= -50 ? 85 : 0,
      typeof context?.price_change_h1 === 'number' && context.price_change_h1 <= -30 ? 70 : 0,
    ));

    const liquidityRisk = this.clamp(Math.max(
      velocity?.liquidity_usd != null && velocity.liquidity_usd < 5000 ? 90 : 0,
      velocity?.liquidity_usd != null && velocity.liquidity_usd < 20000 ? 70 : 0,
      velocity?.liquidity_usd != null && velocity.liquidity_usd < 50000 ? 50 : 0,
      velocity?.liquidity_ratio != null && velocity.liquidity_ratio > 5 ? 80 : 0,
      velocity?.liquidity_ratio != null && velocity.liquidity_ratio > 3 ? 60 : 0,
      velocity?.liquidity_to_mcap_ratio != null && velocity.liquidity_to_mcap_ratio < 0.01 ? 75 : 0,
      velocity?.liquidity_to_mcap_ratio != null && velocity.liquidity_to_mcap_ratio < 0.03 ? 55 : 0,
      velocity?.quote_slippage_risk ?? 0,
      context?.lp_locked === false ? 85 : 0,
    ));

    const m5SellPressure = (velocity?.sell_volume_m5 ?? 0) > (velocity?.buy_volume_m5 ?? 0) * 1.5;
    const m15SellPressure = (velocity?.sell_volume_m15 ?? 0) > (velocity?.buy_volume_m15 ?? 0) * 1.4;
    const h1SellPressure = (velocity?.sell_volume_h1 ?? 0) > (velocity?.buy_volume_h1 ?? 0) * 1.3;
    const entryRisk = this.clamp(Math.max(
      typeof context?.price_change_h1 === 'number' && context.price_change_h1 >= 250 && liquidityRisk >= 60 ? 80 : 0,
      typeof context?.price_change_h1 === 'number' && context.price_change_h1 >= 150 ? 65 : 0,
      typeof context?.price_change_h1 === 'number' && context.price_change_h1 <= -30 ? 75 : 0,
      velocity?.tweet_is_bot_pump ? 75 : 0,
      velocity?.same_slot_bundle_detected ? 75 : 0,
      velocity?.has_paid_boost && (dumpRisk >= 60 || m5SellPressure || m15SellPressure || h1SellPressure) ? 70 : 0,
      m5SellPressure ? 65 : 0,
      m15SellPressure ? 60 : 0,
      h1SellPressure ? 55 : 0,
    ));

    const clusterRisk = this.clamp(Math.max(
      input.cluster_risk ?? 50,
      velocity?.same_slot_bundle_detected ? 70 : 0,
    ));
    const weightedRisk = rugRisk * 0.25 + dumpRisk * 0.25 + liquidityRisk * 0.20 + clusterRisk * 0.15 + entryRisk * 0.15;
    const categoryFloor = Math.max(
      rugRisk >= 80 ? 80 : 0,
      liquidityRisk >= 80 ? 55 : 0,
      dumpRisk >= 75 ? 55 : 0,
      entryRisk >= 65 ? 50 : 0,
    );
    const riskScore = this.clamp(Math.max(weightedRisk, categoryFloor));

    const organicMomentum = this.clamp(Math.max(
      velocity?.hype_detected && !velocity?.tweet_is_bot_pump ? 70 : 0,
      velocity?.twitter_sentiment_score != null ? velocity.twitter_sentiment_score : 0,
      typeof context?.price_change_h1 === 'number' && context.price_change_h1 > 20 && context.price_change_h1 < 150 ? 65 : 0,
    ));
    const smartMoneyAccumulation = this.clamp(Math.max(
      (smart?.alpha_wallet_accumulating_score ?? 0) / 2,
      smart?.net_flow_direction === 'ACCUMULATING' ? 65 : 0,
    ));
    const holderGrowthQuality = this.clamp(100 - Math.max(0, input.cluster_risk ?? 50));
    const liquidityQuality = this.clamp(100 - liquidityRisk);
    const narrativeStrength = this.clamp(velocity?.ai_sentiment === 'BULLISH' ? 75 : velocity?.hype_detected ? 60 : 40);
    const opportunityScore = this.clamp(
      organicMomentum * 0.30 + smartMoneyAccumulation * 0.25 + holderGrowthQuality * 0.20 + liquidityQuality * 0.15 + narrativeStrength * 0.10,
    );

    const rawAction = this.getTraderAction(rugRisk, dumpRisk, liquidityRisk, riskScore, opportunityScore);
    const confidence = input.confidence ?? this.calculateConfidence(input);
    const actionCap = this.getActionCap(input, confidence);
    const action = this.capAction(rawAction, actionCap);
    const warnings = [
      ...(confidence < 0.5 ? ['LOW_CONFIDENCE_ACTION_CAPPED'] : []),
      ...(this.isMissingCoreCoverage(input) ? ['CORE_ENGINE_COVERAGE_LOW'] : []),
      ...(action !== rawAction ? [`ACTION_CAPPED_FROM_${rawAction}`] : []),
    ];

    return {
      risk_score: Math.round(riskScore * 10) / 10,
      opportunity_score: Math.round(opportunityScore * 10) / 10,
      action,
      raw_action: rawAction,
      confidence,
      warnings,
      categories: {
        rug_risk: Math.round(rugRisk),
        dump_risk: Math.round(dumpRisk),
        liquidity_risk: Math.round(liquidityRisk),
        cluster_risk: Math.round(clusterRisk),
        entry_risk: Math.round(entryRisk),
      },
      opportunity: {
        organic_momentum: Math.round(organicMomentum),
        smart_money_accumulation: Math.round(smartMoneyAccumulation),
        holder_growth_quality: Math.round(holderGrowthQuality),
        liquidity_quality: Math.round(liquidityQuality),
        narrative_strength: Math.round(narrativeStrength),
      },
    };
  }

  private getTraderAction(
    rugRisk: number,
    dumpRisk: number,
    liquidityRisk: number,
    riskScore: number,
    opportunityScore: number,
  ): TraderAction {
    if (rugRisk >= 80) return 'AVOID';
    if (liquidityRisk >= 80) return 'AVOID_OR_TINY_SIZE';
    if (dumpRisk >= 75) return 'EXIT_OR_AVOID';
    if (riskScore < 45 && opportunityScore >= 60) return 'OK';
    if (riskScore < 60 && opportunityScore >= 70) return 'OK_SMALL_SIZE';
    if (riskScore < 70 && opportunityScore >= 50) return 'WATCH_OR_SCALP';
    return 'AVOID';
  }

  private calculateConfidence(input: ScoringInput): number {
    const weights = ScoringService.WEIGHTS[input.market_mode ?? 'NORMAL'];
    const modules: ScoringModuleKey[] = ['cluster_risk', 'velocity_score', 'smart_money', 'basic_onchain'];
    const confidence = modules.reduce((sum, key) => sum + (this.isAvailableScore(input[key]) ? weights[key] : 0), 0);
    return Math.round(confidence * 100) / 100;
  }

  private isMissingCoreCoverage(input: ScoringInput): boolean {
    const hasOnchain = this.isAvailableScore(input.basic_onchain);
    const hasCluster = this.isAvailableScore(input.cluster_risk);
    const hasSmart = this.isAvailableScore(input.smart_money);
    return !hasOnchain || (!hasCluster && !hasSmart);
  }

  private getActionCap(input: ScoringInput, confidence: number): TraderAction {
    if (confidence < 0.3) return 'AVOID';
    if (confidence < 0.5 || this.isMissingCoreCoverage(input)) return 'WATCH_OR_SCALP';
    return 'OK';
  }

  private capAction(action: TraderAction, cap: TraderAction): TraderAction {
    const rank: Record<TraderAction, number> = {
      AVOID: 0,
      EXIT_OR_AVOID: 1,
      AVOID_OR_TINY_SIZE: 2,
      WATCH_OR_SCALP: 3,
      OK_SMALL_SIZE: 4,
      OK: 5,
    };
    if (rank[action] <= rank[cap]) return action;
    return cap;
  }

  private clamp(value: number): number {
    return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  private calculateScoreFloor(input: ScoringInput, onchainScore: number | null): number {
    const context = input.risk_context;
    let floor = onchainScore != null && onchainScore >= 90 ? 80
      : onchainScore != null && onchainScore >= 80 ? 70
      : onchainScore != null && onchainScore >= 65 ? 55
      : 0;

    if (!context) return floor;

    const priceChange = context.price_change_h1;
    if (typeof priceChange === 'number') {
      if (priceChange <= -90) floor = Math.max(floor, 95);
      else if (priceChange <= -70) floor = Math.max(floor, 90);
      else if (priceChange <= -50) floor = Math.max(floor, 85);
      else if (priceChange <= -30) floor = Math.max(floor, 75);
    }

    if (context.lp_locked === false) floor = Math.max(floor, 85);
    else if (context.lp_locked == null || context.lp_lock_confidence === 'unknown') floor = Math.max(floor, 50);
    if (context.freeze_authority_revoked === false) floor = Math.max(floor, 80);
    if (context.mint_authority_revoked === false) floor = Math.max(floor, 70);
    if ((context.rugcheck_critical_count ?? 0) > 0) floor = Math.max(floor, 85);

    const severeCount = [
      typeof priceChange === 'number' && priceChange <= -50,
      context.lp_locked === false,
      context.freeze_authority_revoked === false,
      context.mint_authority_revoked === false,
      (context.rugcheck_critical_count ?? 0) > 0,
      context.dev_dump_detected === true,
    ].filter(Boolean).length;
    if (severeCount >= 2) floor = Math.max(floor, 90);

    return floor;
  }

  private isAvailableScore(score: number | null | undefined): score is number {
    return typeof score === 'number' && Number.isFinite(score);
  }

  private buildEmptyBreakdown(
    input: ScoringInput,
    baseWeights: Record<ScoringModuleKey, number>,
  ): ScoringResult['breakdown'] {
    return {
      cluster_risk: { score: input.cluster_risk ?? null, weight: 0, base_weight: baseWeights.cluster_risk, contribution: 0, available: false },
      velocity_score: { score: input.velocity_score ?? null, weight: 0, base_weight: baseWeights.velocity_score, contribution: 0, available: false },
      smart_money: { score: input.smart_money ?? null, weight: 0, base_weight: baseWeights.smart_money, contribution: 0, available: false },
      basic_onchain: { score: input.basic_onchain ?? null, weight: 0, base_weight: baseWeights.basic_onchain, contribution: 0, available: false },
    };
  }

  private getRiskLevel(score: number): RiskLevel {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }
}

export type MarketMode = 'NORMAL' | 'HYPE' | 'FEAR';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ScoringModuleKey = 'cluster_risk' | 'velocity_score' | 'smart_money' | 'basic_onchain';

export interface ScoringInput {
  cluster_risk: number | null;
  velocity_score: number | null;
  smart_money: number | null;
  basic_onchain: number | null;
  market_mode?: MarketMode;
  confidence?: number;
  risk_context?: {
    price_change_h1?: number | null;
    lp_locked?: boolean | null;
    lp_lock_confidence?: 'verified' | 'unknown' | null;
    mint_authority_revoked?: boolean | null;
    freeze_authority_revoked?: boolean | null;
    rugcheck_critical_count?: number;
    dev_dump_detected?: boolean;
    is_pumpfun_token?: boolean;
    pump_is_graduated?: boolean;
    dex_pool_count?: number;
  };
  degen_signals?: {
    hype_detected: boolean;
  };
  velocity_context?: {
    hype_detected?: boolean;
    tweet_is_bot_pump?: boolean;
    liquidity_ratio?: number | null;
    liquidity_usd?: number | null;
    liquidity_to_mcap_ratio?: number | null;
    quote_slippage_risk?: number;
    has_paid_boost?: boolean;
    same_slot_bundle_detected?: boolean;
    buy_volume_m5?: number;
    sell_volume_m5?: number;
    buy_volume_m15?: number;
    sell_volume_m15?: number;
    buy_volume_h1?: number;
    sell_volume_h1?: number;
    twitter_sentiment_score?: number | null;
    ai_sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' | null;
  };
  smart_money_context?: {
    net_flow_direction?: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
    alpha_wallet_accumulating_score?: number;
    alpha_wallet_selling_score?: number;
  };
}

export type TraderAction = 'AVOID' | 'AVOID_OR_TINY_SIZE' | 'EXIT_OR_AVOID' | 'WATCH_OR_SCALP' | 'OK_SMALL_SIZE' | 'OK';

export interface TraderScoringResult {
  risk_score: number;
  opportunity_score: number;
  action: TraderAction;
  raw_action: TraderAction;
  confidence: number;
  warnings: string[];
  categories: {
    rug_risk: number;
    dump_risk: number;
    liquidity_risk: number;
    cluster_risk: number;
    entry_risk: number;
  };
  opportunity: {
    organic_momentum: number;
    smart_money_accumulation: number;
    holder_growth_quality: number;
    liquidity_quality: number;
    narrative_strength: number;
  };
}

export interface ScoringResult {
  final_score: number;
  risk_level: RiskLevel;
  market_mode: MarketMode;
  is_degen_play: boolean;
  confidence: number;
  warnings: string[];
  breakdown: Record<ScoringModuleKey, {
    score: number | null;
    weight: number;
    base_weight: number;
    contribution: number;
    available: boolean;
  }>;
  weights: Record<string, number>;
}
