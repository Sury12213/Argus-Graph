import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { ClusterService } from '../cluster/cluster.service';
import { VelocityService } from '../velocity/velocity.service';
import { SmartMoneyService } from '../smart-money/smart-money.service';
import { SocialService } from '../social/social.service';
import { ScoringService } from '../scoring/scoring.service';
import { DecisionService } from '../decision/decision.service';
import { AiService } from '../ai/ai.service';
import { UserService } from '../user/user.service';
import { HeliusService } from '../../providers/helius/helius.service';
import { TokenResolverService } from '../token/token-resolver.service';
import { RedisService } from '../../providers/redis/redis.service';

/**
 * Scan Orchestrator — core Argus-Graph pipeline
 *
 * Pipeline:
 *   1. Parse user intent (rule-based + AI fallback)
 *   2. Resolve token address
 *   3. Run ALL engines in parallel (Promise.all)
 *   4. Calculate deterministic score
 *   5. Apply user decision rules
 *   6. Generate AI explanation
 *   7. Save & return results
 */
type ScanSource = 'MANUAL' | 'WATCHLIST';

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private prisma: PrismaService,
    private cluster: ClusterService,
    private velocity: VelocityService,
    private smartMoney: SmartMoneyService,
    private social: SocialService,
    private scoring: ScoringService,
    private decision: DecisionService,
    private ai: AiService,
    private user: UserService,
    private helius: HeliusService,
    private tokenResolver: TokenResolverService,
    private redis: RedisService,
  ) {}

  /**
   * Execute a full token scan from natural language or direct address input.
   */
  async executeScan(userId: string, input: string, requestId?: string, source: ScanSource = 'MANUAL') {
    if (requestId) {
      const cachedResult = await this.redis.cacheGet<any>(`scan_request:${userId}:${requestId}`);
      if (cachedResult) return cachedResult;
    }
    const lockKey = `scan_lock:${userId}:${this.normalizeScanInput(input)}`;
    const lockToken = await this.redis.acquireLock(lockKey, 30);
    if (!lockToken) {
      throw new ConflictException({
        code: 'SCAN_ALREADY_RUNNING',
        message: 'A scan for this input is already running. Please wait a moment before retrying.',
      });
    }

    try {
      return await this.runScan(userId, input, requestId, source);
    } finally {
      await this.redis.releaseLock(lockKey, lockToken);
    }
  }

  private async runScan(userId: string, input: string, requestId: string | undefined, source: ScanSource) {
    const startTime = Date.now();
    this.logger.log(`Scan initiated by ${userId}: "${input}"`);

    // Step 1 parses user input into a structured scan intent.
    const intent = await this.ai.parseIntent(input);
    this.logger.debug(`Intent: ${JSON.stringify(intent)}`);

    const resolution = await this.tokenResolver.resolve({
      token_address: intent.token_address,
      token_symbol: intent.token_symbol,
      raw_input: input,
    });
    if (resolution.status === 'AMBIGUOUS') {
      throw new BadRequestException({
        code: 'TOKEN_SYMBOL_AMBIGUOUS',
        message: 'Multiple Solana token candidates were found. Please scan by mint address or choose a specific candidate.',
        candidates: resolution.candidates,
      });
    }
    const tokenAddress = resolution.tokenAddress!;

    // Step 2 fetches token metadata used by engines and display output.
    const tokenMetadata = await this.helius.getTokenMetadata(tokenAddress);

    // Step 3 runs engines in parallel and isolates provider failures so one outage does not fail the scan.
    const [clusterSettled, velocitySettled, smartMoneySettled, socialSettled] =
      await Promise.allSettled([
        this.cluster.analyze(tokenAddress),
        this.velocity.analyze(tokenAddress),
        this.smartMoney.analyze(tokenAddress),
        this.social.analyze(tokenAddress, tokenMetadata?.symbol),
      ]);

    const engineWarnings: string[] = [];
    const getSettledValue = <T>(
      label: string,
      result: PromiseSettledResult<T>,
    ): T | null => {
      if (result.status === 'fulfilled') return result.value;
      const message = result.reason?.message ?? String(result.reason);
      this.logger.warn(`[SCAN] ${label} engine unavailable: ${message}`);
      engineWarnings.push(`${label.toUpperCase()}_ENGINE_UNAVAILABLE`);
      return null;
    };

    const clusterResult = getSettledValue('cluster', clusterSettled);
    const velocityResult = getSettledValue('velocity', velocitySettled);
    const smartMoneyResult = getSettledValue('smart_money', smartMoneySettled);
    const socialResult = getSettledValue('social', socialSettled);

    this.logger.debug(`Engines completed in ${Date.now() - startTime}ms`);

    // Step 4 calculates base on-chain risk before engine-specific weighting.
    const basicOnchain = this.calculateBasicOnchain(tokenMetadata);

    // Detect market mode from available velocity signals
    const marketMode = velocityResult?.hype_detected ? 'HYPE' : 'NORMAL';

    const rugcheckCriticalCount = (tokenMetadata?.rugcheck_risks_normalized ?? [])
      .filter((risk: any) => risk.severity === 'critical').length;

    // Step 5 combines deterministic engine scores into final risk scoring.
    const lpContext = this.buildLpContext(tokenMetadata, velocityResult);

    const scoringResult = this.scoring.calculateFinalScore({
      cluster_risk: clusterResult?.cluster_risk ?? null,
      velocity_score: velocityResult?.velocity_score ?? null,
      smart_money: smartMoneyResult?.smart_money_score ?? null,
      basic_onchain: basicOnchain,
      market_mode: marketMode,
      risk_context: {
        price_change_h1: velocityResult?.price_change_h1 ?? null,
        lp_locked: tokenMetadata?.lp_locked ?? null,
        lp_lock_confidence: tokenMetadata?.lp_lock_confidence ?? null,
        mint_authority_revoked: tokenMetadata?.mint_authority_revoked ?? null,
        freeze_authority_revoked: tokenMetadata?.freeze_authority_revoked ?? null,
        rugcheck_critical_count: rugcheckCriticalCount,
        dev_dump_detected: smartMoneyResult?.dev_dump_detected ?? false,
        ...lpContext,
      },
      degen_signals: { hype_detected: velocityResult?.hype_detected ?? false },
      velocity_context: {
        hype_detected: velocityResult?.hype_detected ?? false,
        tweet_is_bot_pump: velocityResult?.tweet_is_bot_pump ?? false,
        liquidity_ratio: velocityResult?.liquidity_ratio ?? null,
        liquidity_usd: velocityResult?.liquidity_usd ?? null,
        liquidity_to_mcap_ratio: velocityResult?.liquidity_to_mcap_ratio ?? null,
        quote_slippage_risk: velocityResult?.quote_slippage_risk ?? 0,
        has_paid_boost: velocityResult?.has_paid_boost ?? false,
        same_slot_bundle_detected: velocityResult?.same_slot_bundle_detected ?? false,
        buy_volume_m5: velocityResult?.buy_volume_m5 ?? 0,
        sell_volume_m5: velocityResult?.sell_volume_m5 ?? 0,
        buy_volume_m15: velocityResult?.buy_volume_m15 ?? 0,
        sell_volume_m15: velocityResult?.sell_volume_m15 ?? 0,
        buy_volume_h1: velocityResult?.buy_volume_h1 ?? 0,
        sell_volume_h1: velocityResult?.sell_volume_h1 ?? 0,
        twitter_sentiment_score: velocityResult?.twitter_sentiment_score ?? null,
        ai_sentiment: velocityResult?.ai_sentiment ?? null,
      },
      smart_money_context: {
        net_flow_direction: smartMoneyResult?.net_flow_direction,
        alpha_wallet_accumulating_score: smartMoneyResult?.alpha_wallet_accumulating_score ?? 0,
        alpha_wallet_selling_score: smartMoneyResult?.alpha_wallet_selling_score ?? 0,
      },
    });
    const traderScoringResult = this.scoring.calculateTraderScore({
      cluster_risk: clusterResult?.cluster_risk ?? null,
      velocity_score: velocityResult?.velocity_score ?? null,
      smart_money: smartMoneyResult?.smart_money_score ?? null,
      basic_onchain: basicOnchain,
      market_mode: marketMode,
      confidence: scoringResult.confidence,
      risk_context: {
        price_change_h1: velocityResult?.price_change_h1 ?? null,
        lp_locked: tokenMetadata?.lp_locked ?? null,
        lp_lock_confidence: tokenMetadata?.lp_lock_confidence ?? null,
        mint_authority_revoked: tokenMetadata?.mint_authority_revoked ?? null,
        freeze_authority_revoked: tokenMetadata?.freeze_authority_revoked ?? null,
        rugcheck_critical_count: rugcheckCriticalCount,
        dev_dump_detected: smartMoneyResult?.dev_dump_detected ?? false,
        ...lpContext,
      },
      degen_signals: { hype_detected: velocityResult?.hype_detected ?? false },
      velocity_context: {
        hype_detected: velocityResult?.hype_detected ?? false,
        tweet_is_bot_pump: velocityResult?.tweet_is_bot_pump ?? false,
        liquidity_ratio: velocityResult?.liquidity_ratio ?? null,
        liquidity_usd: velocityResult?.liquidity_usd ?? null,
        liquidity_to_mcap_ratio: velocityResult?.liquidity_to_mcap_ratio ?? null,
        quote_slippage_risk: velocityResult?.quote_slippage_risk ?? 0,
        has_paid_boost: velocityResult?.has_paid_boost ?? false,
        same_slot_bundle_detected: velocityResult?.same_slot_bundle_detected ?? false,
        buy_volume_m5: velocityResult?.buy_volume_m5 ?? 0,
        sell_volume_m5: velocityResult?.sell_volume_m5 ?? 0,
        buy_volume_m15: velocityResult?.buy_volume_m15 ?? 0,
        sell_volume_m15: velocityResult?.sell_volume_m15 ?? 0,
        buy_volume_h1: velocityResult?.buy_volume_h1 ?? 0,
        sell_volume_h1: velocityResult?.sell_volume_h1 ?? 0,
        twitter_sentiment_score: velocityResult?.twitter_sentiment_score ?? null,
        ai_sentiment: velocityResult?.ai_sentiment ?? null,
      },
      smart_money_context: {
        net_flow_direction: smartMoneyResult?.net_flow_direction,
        alpha_wallet_accumulating_score: smartMoneyResult?.alpha_wallet_accumulating_score ?? 0,
        alpha_wallet_selling_score: smartMoneyResult?.alpha_wallet_selling_score ?? 0,
      },
    });
    const riskDrivers = this.buildRiskDrivers(tokenMetadata, velocityResult, clusterResult, smartMoneyResult);
    const warnings = [...engineWarnings, ...(tokenMetadata?.warnings ?? []), ...scoringResult.warnings];

    // Step 6 applies user risk settings and policy gates to produce the decision.
    const userSettings = await this.user.getUserSettings(userId);
    const decisionResult = this.decision.decide(
      scoringResult.final_score,
      userSettings ?? { maxRiskScore: 50, autoExitEnabled: false, slippageBps: 100 },
    );

    // Step 7 asks AI to explain existing scores without changing the decision.
    const aiInput = {
      tokenSymbol: tokenMetadata?.symbol ?? intent.token_symbol ?? 'UNKNOWN',
      tokenAddress,
      finalScore: scoringResult.final_score,
      clusterRisk: clusterResult?.cluster_risk ?? 0,
      velocityScore: velocityResult?.velocity_score ?? 0,
      smartMoney: smartMoneyResult?.smart_money_score ?? 0,
      basicOnchain,
      decision: decisionResult.decision,
      rawData: {
        cluster: clusterResult,
        velocity: velocityResult,
        smartMoney: smartMoneyResult,
        social: socialResult,
        riskDrivers,
        warnings,
      },
    };
    const [aiExplanation, aiSummary] = await Promise.all([
      this.ai.generateExplanation(aiInput),
      this.ai.generateScanSummary(aiInput),
    ]);

    // Step 8 persists scan history after all derived outputs are ready.
    const scan = await this.prisma.scan.create({
      data: {
        userId,
        tokenAddress,
        tokenSymbol: tokenMetadata?.symbol ?? intent.token_symbol,
        tokenName: tokenMetadata?.name,
        clusterRisk: clusterResult?.cluster_risk ?? 0,
        velocityScore: velocityResult?.velocity_score ?? 0,
        smartMoney: smartMoneyResult?.smart_money_score ?? 0,
        basicOnchain,
        finalScore: scoringResult.final_score,
        decision: decisionResult.decision,
        aiExplanation,
        source,
        rawData: JSON.parse(JSON.stringify({
          intent,
          resolution,
          tokenMetadata,
          cluster: clusterResult,
          velocity: velocityResult,
          smartMoney: smartMoneyResult,
          social: socialResult,
          riskDrivers,
          scoring: scoringResult,
          traderScoring: traderScoringResult,
          decision: decisionResult,
          warnings,
          aiSummary,
        })),
      },
    });

    const totalTime = Date.now() - startTime;
    this.logger.log(
      `Scan completed: ${tokenMetadata?.symbol ?? tokenAddress} | Score: ${scoringResult.final_score} | Decision: ${decisionResult.decision} | ${totalTime}ms`,
    );

    const response = {
      id: scan.id,
      token: {
        address: tokenAddress,
        symbol: tokenMetadata?.symbol,
        name: tokenMetadata?.name,
        decimals: tokenMetadata?.decimals ?? null,
        supply: tokenMetadata?.supply ?? null,
        holder_count: tokenMetadata?.holder_count ?? null,
        creator: tokenMetadata?.creator ?? null,
        created_at: tokenMetadata?.created_at ?? null,
        lp_locked: tokenMetadata?.lp_locked ?? null,
        lp_lock_percentage: tokenMetadata?.lp_lock_percentage ?? null,
        lp_lock_confidence: tokenMetadata?.lp_lock_confidence ?? null,
        lp_locked_pct: tokenMetadata?.lp_locked_pct ?? null,
        lp_burn_pct: tokenMetadata?.lp_burn_pct ?? null,
        lp_status: tokenMetadata?.lp_status ?? null,
        lp_details: tokenMetadata?.lp_details ?? [],
        rugcheck_score: tokenMetadata?.rugcheck_score ?? null,
        rugcheck_risks_normalized: tokenMetadata?.rugcheck_risks_normalized ?? [],
        pool_addresses: tokenMetadata?.pool_addresses ?? [],
        mint_authority_revoked: tokenMetadata?.mint_authority_revoked ?? null,
        freeze_authority_revoked: tokenMetadata?.freeze_authority_revoked ?? null,
        rug_risks: tokenMetadata?.rug_risks ?? [],
      },
      scores: {
        final: scoringResult.final_score,
        risk_level: scoringResult.risk_level,
        market_mode: scoringResult.market_mode,
        is_degen_play: scoringResult.is_degen_play,
        confidence: scoringResult.confidence,
        cluster_risk: clusterResult?.cluster_risk ?? null,
        velocity_score: velocityResult?.velocity_score ?? null,
        smart_money: smartMoneyResult?.smart_money_score ?? null,
        basic_onchain: basicOnchain,
        breakdown: scoringResult.breakdown,
        trader: traderScoringResult,
      },
      decision: decisionResult,
      explanation: aiExplanation,
      ai_summary: aiSummary,
      engines: {
        cluster: clusterResult,
        velocity: velocityResult,
        smart_money: smartMoneyResult,
        social: socialResult,
      },
      risk_drivers: riskDrivers,
      warnings,
      metadata: {
        resolution: resolution.candidates?.[0] ?? null,
        scan_time_ms: totalTime,
        timestamp: scan.createdAt,
      },
    };

    if (requestId) {
      await this.redis.cacheSet(`scan_request:${userId}:${requestId}`, response, 300);
    }

    return response;
  }

  /**
   * Get scan history for a user.
   */
  async getScanHistory(userId: string, take = 20) {
    const scans = await this.prisma.scan.findMany({
      where: { userId, source: 'MANUAL' },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        tokenAddress: true,
        tokenSymbol: true,
        tokenName: true,
        finalScore: true,
        clusterRisk: true,
        velocityScore: true,
        smartMoney: true,
        basicOnchain: true,
        decision: true,
        rawData: true,
        createdAt: true,
      },
    });

    return scans.map((scan: any) => ({
      id: scan.id,
      tokenAddress: scan.tokenAddress,
      tokenSymbol: scan.tokenSymbol,
      tokenName: scan.tokenName,
      finalScore: scan.finalScore,
      clusterRisk: scan.clusterRisk ?? scan.rawData?.cluster?.cluster_risk ?? scan.rawData?.scoring?.breakdown?.cluster_risk ?? null,
      velocityScore: scan.velocityScore ?? scan.rawData?.velocity?.velocity_score ?? scan.rawData?.scoring?.breakdown?.velocity_score ?? null,
      smartMoney: scan.smartMoney ?? scan.rawData?.smartMoney?.smart_money_score ?? scan.rawData?.scoring?.breakdown?.smart_money ?? null,
      basicOnchain: scan.basicOnchain ?? scan.rawData?.scoring?.breakdown?.basic_onchain ?? null,
      decision: scan.decision,
      createdAt: scan.createdAt,
    }));
  }

  /**
   * Get a specific scan result by ID.
   */
  async getScanById(scanId: string, userId: string) {
    const scan = await this.prisma.scan.findFirst({
      where: { id: scanId, userId },
    });
    if (!scan) return null;

    return {
      ...scan,
      ai_summary: (scan.rawData as any)?.aiSummary ?? null,
    };
  }

  // Helpers normalize scan input and map provider output into persisted records.


  private normalizeScanInput(input: string): string {
    return input.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private buildLpContext(metadata: any, velocity: any) {
    const isPumpfunToken = velocity?.sources?.pumpfun === true || velocity?.pump_reply_count > 0 || velocity?.pump_king_of_hill === true;
    const dexPoolCount = Array.isArray(metadata?.lp_details) && metadata.lp_details.length > 0
      ? metadata.lp_details.length
      : Array.isArray(metadata?.pool_addresses) ? metadata.pool_addresses.length : 0;

    return {
      is_pumpfun_token: isPumpfunToken,
      pump_is_graduated: velocity?.pump_is_graduated ?? false,
      dex_pool_count: dexPoolCount,
    };
  }

  private buildRiskDrivers(metadata: any, velocity: any, cluster: any, smartMoney: any) {
    const drivers: Array<{ severity: string; category: string; message: string; evidence: string }> = [];
    const priceChange = velocity?.price_change_h1;
    if (typeof priceChange === 'number' && priceChange <= -30) {
      drivers.push({
        severity: priceChange <= -70 ? 'critical' : 'high',
        category: 'price',
        message: `Token dropped ${Math.abs(priceChange).toFixed(0)}% over 1h`,
        evidence: `price_change_h1=${priceChange}`,
      });
    }
    const lpContext = this.buildLpContext(metadata, velocity);
    if (metadata?.lp_locked === false) {
      drivers.push({ severity: 'critical', category: 'liquidity', message: 'Liquidity is unlocked or risky', evidence: `lp_locked=${metadata.lp_locked}` });
    } else if (metadata?.lp_locked == null || metadata?.lp_lock_confidence === 'unknown') {
      const preMigration = lpContext.is_pumpfun_token && lpContext.pump_is_graduated === false;
      drivers.push({
        severity: preMigration ? 'medium' : 'high',
        category: 'liquidity',
        message: preMigration ? 'Pump.fun pre-migration: DEX LP lock is not expected yet' : 'DEX LP lock is not verified',
        evidence: `dex_pool_count=${lpContext.dex_pool_count}`,
      });
    }
    if (metadata?.freeze_authority_revoked === false) {
      drivers.push({ severity: 'critical', category: 'authority', message: 'Freeze authority is still active', evidence: 'freeze_authority_revoked=false' });
    }
    if (metadata?.mint_authority_revoked === false) {
      drivers.push({ severity: 'high', category: 'authority', message: 'Mint authority is still active', evidence: 'mint_authority_revoked=false' });
    }
    for (const risk of metadata?.rugcheck_risks_normalized ?? []) {
      if (risk.severity === 'critical' || risk.severity === 'high') {
        drivers.push({ severity: risk.severity, category: 'rugcheck', message: risk.label, evidence: `rugcheck:${risk.category}` });
      }
    }
    if (smartMoney?.dev_dump_detected) {
      drivers.push({ severity: 'critical', category: 'smart_money', message: 'Developer wallet distribution detected', evidence: `dev_net_sold_pct=${smartMoney.dev_net_sold_pct}` });
    }
    if (smartMoney?.whale_concentration >= 40) {
      drivers.push({ severity: 'high', category: 'holders', message: `Top holders control ${smartMoney.whale_concentration}%`, evidence: `distribution_grade=${smartMoney.distribution_grade}` });
    }
    if (cluster?.cluster_risk >= 70) {
      drivers.push({ severity: 'high', category: 'cluster', message: 'Wallet cluster risk is elevated', evidence: `cluster_risk=${cluster.cluster_risk}` });
    }
    return drivers.slice(0, 8);
  }

  private getLpUnknownPenalty(metadata: any): number {
    const dexPoolCount = Array.isArray(metadata?.lp_details) && metadata.lp_details.length > 0
      ? metadata.lp_details.length
      : Array.isArray(metadata?.pool_addresses) ? metadata.pool_addresses.length : 0;
    return dexPoolCount > 0 ? 15 : 20;
  }

  /**
   * Calculate basic on-chain risk score from token metadata.
   */
  private calculateBasicOnchain(metadata: any): number {
    if (!metadata) return 50;

    let score = 0;

    if (!metadata.freeze_authority_revoked) score += 25;
    if (!metadata.mint_authority_revoked) score += 25;

    if (metadata.lp_locked === false) score += 40;
    else if (metadata.lp_locked == null || metadata.lp_lock_confidence === 'unknown') score += this.getLpUnknownPenalty(metadata);
    else if (typeof metadata.lp_lock_percentage === 'number' && metadata.lp_lock_percentage < 80) score += 20;

    const normalizedRisks = metadata.rugcheck_risks_normalized ?? [];
    const criticalCount = normalizedRisks.filter((risk: any) => risk.severity === 'critical').length;
    const highCount = normalizedRisks.filter((risk: any) => risk.severity === 'high').length;
    const mediumCount = normalizedRisks.filter((risk: any) => risk.severity === 'medium').length;
    score += Math.min(50, criticalCount * 25);
    score += highCount * 15;
    score += mediumCount * 8;

    const createdAt = metadata.created_at ? new Date(metadata.created_at).getTime() : NaN;
    if (Number.isFinite(createdAt)) {
      const ageHours = (Date.now() - createdAt) / 3600000;
      if (ageHours >= 0 && ageHours < 1) score += 30;
      else if (ageHours < 6) score += 20;
      else if (ageHours < 24) score += 10;
    }

    if (metadata.holder_count > 0 && metadata.holder_count < 50) score += 15;
    else if (metadata.holder_count > 0 && metadata.holder_count < 200) score += 5;

    return Math.min(100, score);
  }
}
