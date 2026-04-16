import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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

/**
 * 🎯 Scan Orchestrator — The Heart of Argus-Graph
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
  ) {}

  /**
   * Execute a full token scan from natural language or direct address input.
   */
  async executeScan(userId: string, input: string) {
    const startTime = Date.now();
    this.logger.log(`🔍 Scan initiated by ${userId}: "${input}"`);

    // ── Step 1: Parse Intent ──
    const intent = await this.ai.parseIntent(input);
    this.logger.debug(`Intent: ${JSON.stringify(intent)}`);

    // Resolve token address — use mock addresses for demo symbols
    const tokenAddress = this.resolveTokenAddress(intent);
    if (!tokenAddress) {
      throw new BadRequestException(
        'Could not resolve token address. Please provide a valid Solana token address or symbol.',
      );
    }

    // ── Step 2: Get token metadata ──
    const tokenMetadata = await this.helius.getTokenMetadata(tokenAddress);

    // ── Step 3: Run ALL engines in parallel ──
    const [clusterResult, velocityResult, smartMoneyResult, socialResult] =
      await Promise.all([
        this.cluster.analyze(tokenAddress),
        this.velocity.analyze(tokenAddress),
        this.smartMoney.analyze(tokenAddress),
        this.social.analyze(tokenAddress),
      ]);

    this.logger.debug(`Engines completed in ${Date.now() - startTime}ms`);

    // ── Step 4: Calculate basic on-chain score ──
    const basicOnchain = this.calculateBasicOnchain(tokenMetadata);

    // ── Step 5: Deterministic Scoring ──
    const scoringResult = this.scoring.calculateFinalScore({
      cluster_risk: clusterResult.cluster_risk,
      velocity_score: velocityResult.velocity_score,
      smart_money: smartMoneyResult.smart_money_score,
      basic_onchain: basicOnchain,
    });

    // ── Step 6: Decision Layer ──
    const userSettings = await this.user.getUserSettings(userId);
    const decisionResult = this.decision.decide(
      scoringResult.final_score,
      userSettings ?? { maxRiskScore: 50, autoExitEnabled: false, slippageBps: 100 },
    );

    // ── Step 7: AI Explanation ──
    const aiExplanation = await this.ai.generateExplanation({
      tokenSymbol: tokenMetadata?.symbol ?? intent.token_symbol ?? 'UNKNOWN',
      tokenAddress,
      finalScore: scoringResult.final_score,
      clusterRisk: clusterResult.cluster_risk,
      velocityScore: velocityResult.velocity_score,
      smartMoney: smartMoneyResult.smart_money_score,
      basicOnchain,
      decision: decisionResult.decision,
      rawData: {
        cluster: clusterResult,
        velocity: velocityResult,
        smartMoney: smartMoneyResult,
        social: socialResult,
      },
    });

    // ── Step 8: Save to Database ──
    const scan = await this.prisma.scan.create({
      data: {
        userId,
        tokenAddress,
        tokenSymbol: tokenMetadata?.symbol ?? intent.token_symbol,
        tokenName: tokenMetadata?.name,
        clusterRisk: clusterResult.cluster_risk,
        velocityScore: velocityResult.velocity_score,
        smartMoney: smartMoneyResult.smart_money_score,
        basicOnchain,
        finalScore: scoringResult.final_score,
        decision: decisionResult.decision,
        aiExplanation,
        rawData: JSON.parse(JSON.stringify({
          intent,
          tokenMetadata,
          cluster: clusterResult,
          velocity: velocityResult,
          smartMoney: smartMoneyResult,
          social: socialResult,
          scoring: scoringResult,
          decision: decisionResult,
        })),
      },
    });

    const totalTime = Date.now() - startTime;
    this.logger.log(
      `✅ Scan completed: ${tokenMetadata?.symbol ?? tokenAddress} | Score: ${scoringResult.final_score} | Decision: ${decisionResult.decision} | ${totalTime}ms`,
    );

    return {
      id: scan.id,
      token: {
        address: tokenAddress,
        symbol: tokenMetadata?.symbol,
        name: tokenMetadata?.name,
      },
      scores: {
        final: scoringResult.final_score,
        risk_level: scoringResult.risk_level,
        cluster_risk: clusterResult.cluster_risk,
        velocity_score: velocityResult.velocity_score,
        smart_money: smartMoneyResult.smart_money_score,
        basic_onchain: basicOnchain,
        breakdown: scoringResult.breakdown,
      },
      decision: decisionResult,
      explanation: aiExplanation,
      engines: {
        cluster: clusterResult,
        velocity: velocityResult,
        smart_money: smartMoneyResult,
        social: socialResult,
      },
      metadata: {
        scan_time_ms: totalTime,
        timestamp: scan.createdAt,
      },
    };
  }

  /**
   * Get scan history for a user.
   */
  async getScanHistory(userId: string, take = 20) {
    return this.prisma.scan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        tokenAddress: true,
        tokenSymbol: true,
        tokenName: true,
        finalScore: true,
        decision: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get a specific scan result by ID.
   */
  async getScanById(scanId: string, userId: string) {
    return this.prisma.scan.findFirst({
      where: { id: scanId, userId },
    });
  }

  // ── Helpers ──

  /**
   * Resolve token address from parsed intent.
   * Supports mock token symbols for demo.
   */
  private resolveTokenAddress(intent: any): string | null {
    if (intent.token_address) return intent.token_address;

    // Map demo symbols to mock addresses
    const symbolMap: Record<string, string> = {
      '$RUGME': 'ScamToken111111111111111111111111111111111',
      '$SAFU': 'SafeToken222222222222222222222222222222222',
      '$HMMMM': 'MidToken3333333333333333333333333333333333',
      '$MEME': 'ScamToken111111111111111111111111111111111', // Default demo
    };

    const symbol = intent.token_symbol?.toUpperCase();
    return symbol ? symbolMap[symbol] ?? null : null;
  }

  /**
   * Calculate basic on-chain risk score from token metadata.
   */
  private calculateBasicOnchain(metadata: any): number {
    if (!metadata) return 50;

    let score = 0;

    // Mint authority not revoked = risk
    if (!metadata.mint_authority_revoked) score += 25;

    // Freeze authority not revoked = risk
    if (!metadata.freeze_authority_revoked) score += 15;

    // LP not locked = major risk
    if (!metadata.lp_locked) score += 30;
    else if (metadata.lp_lock_percentage < 80) score += 15;

    // Very new token = higher risk
    const ageHours =
      (Date.now() - new Date(metadata.created_at).getTime()) / 3600000;
    if (ageHours < 1) score += 20;
    else if (ageHours < 6) score += 10;
    else if (ageHours < 24) score += 5;

    // Low holder count = risk
    if (metadata.holder_count < 50) score += 15;
    else if (metadata.holder_count < 200) score += 5;

    return Math.min(100, score);
  }
}
