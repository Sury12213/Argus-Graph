import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * LLM Provider — Groq single-provider implementation.
 *
 * Runtime policy:
 * - Uses GROQ_API_KEY only.
 * - Uses one configured model: AI_MODEL or llama-3.1-8b-instant.
 * - No provider/model fallback chain.
 * - AI explains structured data only; it never scores or decides.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GROQ_API_KEY') || this.configService.get<string>('AI_API_KEY') || '';
    this.model = this.configService.get<string>('AI_MODEL') || 'llama-3.1-8b-instant';

    this.logger.log(
      `LLM ${this.apiKey ? 'initialized' : 'disabled'} — Provider: Groq, Model: ${this.model}`,
    );
  }

  /**
   * Parse user natural language input into a structured action.
   * Only called when rule-based parser can't handle the input.
   */
  async parseIntent(userInput: string): Promise<ParsedIntent> {
    if (!this.apiKey) return this.ruleBasedParseIntent(userInput);

    const prompt = `You are an intent parser for a Solana token risk analysis system.
Parse the following user input into a JSON action.

Possible actions:
- SCAN: User wants to check/audit a token
- BUY: User wants to buy a token (will trigger scan first)
- SETTINGS: User wants to change risk settings
- WATCHLIST: User wants to add/remove from watchlist

User input: "${userInput}"

Respond ONLY with valid JSON:
{
  "action": "SCAN|BUY|SETTINGS|WATCHLIST",
  "token_address": "string or null",
  "token_symbol": "string or null",
  "amount_sol": number or null,
  "settings": {} or null
}`;

    const parsed = await this.callGroqJson<ParsedIntent>(prompt, 500);
    return parsed ?? this.ruleBasedParseIntent(userInput);
  }

  /**
   * Generate a human-readable explanation of scan results.
   * MUST NOT invent data — only explain what is in the input.
   */
  async explainDecision(scanData: ScanExplanationInput): Promise<string> {
    if (!this.apiKey) return this.deterministicExplanation(scanData);

    const prompt = `You are a strict Solana token risk analyst. Based only on the STRUCTURED DATA below, write a SHORT investor explanation (max 100 words, in English).

Rules:
- Never say bullish/safe/approved when finalScore >= 50, decision is BLOCKED, price_change_h1 <= -50, liquidity is unlocked, mint/freeze authority is active, or RugCheck risks exist.
- A token that dropped around 99% is bearish/critical even if social hype exists.
- Social hype, KOLs, high buys, or high velocity are NOT bullish when price crashed or on-chain risk is high; describe them as exit-liquidity or volatility risk.
- Mention concrete risk drivers from input: final score, decision, price crash, LP lock, mint/freeze authority, RugCheck risks, cluster/velocity/smart-money signals.
- Do not invent data. Do not give trading advice.

Scan Results:
${JSON.stringify(this.compactScanData(scanData), null, 2)}

Return JSON only: { "explanation": "..." }`;

    const parsed = await this.callGroqJson<{ explanation?: string }>(prompt, 700);
    return parsed?.explanation?.trim() || this.deterministicExplanation(scanData);
  }


  async generateScanSummary(scanData: ScanExplanationInput): Promise<ScanSummary> {
    if (!this.apiKey) return this.deterministicSummary(scanData);

    const prompt = `You are a strict Solana token risk analyst. Create a structured explanation that complements the deterministic decision text.

Rules:
- Do not repeat the opening sentence "Risk score: ..." or "This token is blocked...".
- Do not calculate or change risk scores, risk levels, or decisions.
- Do not invent facts, sources, wallet labels, or trading advice.
- Explain only these fixed engine outputs: finalScore, decision, cluster, velocity, smart money, social, riskDrivers, warnings.
- Use concrete reasons from engine outputs, not generic warnings.
- Keep every bullet under 18 words.
- If evidence is missing, say what to verify, not what happened.

Scan Results:
${JSON.stringify(this.compactScanData(scanData), null, 2)}

Return JSON only:
{
  "whyRisky": ["specific risk driver", "specific risk driver", "specific risk driver"],
  "signalsMatter": ["specific engine signal", "specific engine signal", "specific engine signal"],
  "verifyNext": ["specific manual check", "specific manual check", "specific manual check"]
}`;

    const parsed = await this.callGroqJson<Partial<ScanSummary>>(prompt, 900);
    return this.normalizeSummary(parsed, scanData);
  }
  private async callGroqJson<T>(prompt: string, maxTokens: number): Promise<T | null> {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: 'Return valid JSON only. Do not use markdown.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        this.logger.warn(`[LLM] Groq/${this.model} failed: ${res.status}`);
        return null;
      }

      const data = await res.json() as any;
      const text = data?.choices?.[0]?.message?.content;
      return text ? JSON.parse(text) as T : null;
    } catch (error: any) {
      this.logger.warn(`[LLM] Groq error: ${error.message}`);
      return null;
    }
  }

  private compactScanData(data: ScanExplanationInput) {
    const raw = data.rawData ?? {};
    const tokenMetadata = raw.tokenMetadata ?? {};
    const velocity = raw.velocity ?? {};
    const cluster = raw.cluster ?? {};
    const smartMoney = raw.smartMoney ?? {};
    const social = raw.social ?? {};
    const riskDrivers = Array.isArray(raw.riskDrivers) ? raw.riskDrivers.slice(0, 5) : [];
    const warnings = Array.isArray(raw.warnings) ? raw.warnings.slice(0, 5) : [];

    return {
      tokenSymbol: data.tokenSymbol,
      tokenAddress: data.tokenAddress,
      finalScore: data.finalScore,
      decision: data.decision,
      scores: {
        clusterRisk: data.clusterRisk,
        velocityScore: data.velocityScore,
        smartMoney: data.smartMoney,
        basicOnchain: data.basicOnchain,
      },
      tokenMetadata: {
        symbol: tokenMetadata.symbol,
        name: tokenMetadata.name,
        rug_score: tokenMetadata.rug_score,
        rug_risks: Array.isArray(tokenMetadata.rug_risks) ? tokenMetadata.rug_risks.slice(0, 5) : undefined,
        mint_authority: tokenMetadata.mint_authority,
        freeze_authority: tokenMetadata.freeze_authority,
        lp_locked: tokenMetadata.lp_locked,
      },
      velocity: {
        price_change_h1: velocity.price_change_h1,
        tx_count_h1: velocity.tx_count_h1,
        volume_h1: velocity.volume_h1,
        liquidity_usd: velocity.liquidity_usd,
        flags: Array.isArray(velocity.flags) ? velocity.flags.slice(0, 5) : undefined,
      },
      cluster: {
        funding_clusters: cluster.funding_clusters,
        suspicious_wallet_count: cluster.suspicious_wallet_count,
        max_cluster_size: cluster.max_cluster_size,
        risk_flags: Array.isArray(cluster.risk_flags) ? cluster.risk_flags.slice(0, 5) : undefined,
      },
      smartMoney: {
        net_flow_direction: smartMoney.net_flow_direction,
        smart_wallet_count: smartMoney.smart_wallet_count,
        buy_pressure: smartMoney.buy_pressure,
        sell_pressure: smartMoney.sell_pressure,
      },
      social: {
        sentiment: social.sentiment,
        tweet_growth_rate: social.tweet_growth_rate,
        bot_ratio: social.bot_ratio,
        kol_count: social.kol_count,
      },
      riskDrivers,
      warnings,
    };
  }

  private ruleBasedParseIntent(input: string): ParsedIntent {
    const lower = input.toLowerCase();

    let action: ParsedIntent['action'] = 'SCAN';
    if (lower.includes('buy') || lower.includes('swap')) action = 'BUY';
    else if (lower.includes('setting')) action = 'SETTINGS';
    else if (lower.includes('watch')) action = 'WATCHLIST';

    const symbolMatch = input.match(/\$([A-Za-z]+)/);
    const addressMatch = input.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:SOL|sol)/);

    return {
      action,
      token_address: addressMatch?.[0] ?? null,
      token_symbol: symbolMatch ? `$${symbolMatch[1]}` : null,
      amount_sol: amountMatch ? parseFloat(amountMatch[1]) : null,
      settings: null,
    };
  }


  private normalizeSummary(summary: Partial<ScanSummary> | null | undefined, data: ScanExplanationInput): ScanSummary {
    const fallback = this.deterministicSummary(data);
    const clean = (items: unknown, fallbackItems: string[]) => {
      if (!Array.isArray(items)) return fallbackItems;
      const values = items
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 3);
      return values.length > 0 ? values : fallbackItems;
    };

    return {
      whyRisky: clean(summary?.whyRisky, fallback.whyRisky),
      signalsMatter: clean(summary?.signalsMatter, fallback.signalsMatter),
      verifyNext: clean(summary?.verifyNext, fallback.verifyNext),
    };
  }

  private deterministicSummary(data: ScanExplanationInput): ScanSummary {
    const riskLevel = data.finalScore >= 75 ? 'critical' : data.finalScore >= 50 ? 'high' : data.finalScore >= 30 ? 'medium' : 'low';
    const drivers = Array.isArray(data.rawData?.riskDrivers) ? data.rawData.riskDrivers : [];
    const warnings = Array.isArray(data.rawData?.warnings) ? data.rawData.warnings : [];
    const velocity = data.rawData?.velocity ?? {};
    const smartMoney = data.rawData?.smartMoney ?? {};
    const social = data.rawData?.social ?? {};

    const whyRisky = [
      `Engine score is ${data.finalScore.toFixed(1)}/100 with ${riskLevel} risk level.`,
      data.decision === 'BLOCKED' ? 'Current user guardrails block this token.' : `Decision layer returned ${data.decision}.`,
      drivers[0]?.message ?? warnings[0] ?? 'No dominant critical driver was reported by engines.',
    ];

    const signalsMatter = [
      `Cluster ${data.clusterRisk.toFixed(0)}, velocity ${data.velocityScore.toFixed(0)}, smart money ${data.smartMoney.toFixed(0)}.`,
      typeof velocity.price_change_h1 === 'number' ? `1h price change is ${velocity.price_change_h1.toFixed(1)}%.` : 'Velocity engine has no 1h price change evidence.',
      smartMoney.net_flow_direction ? `Smart money flow direction: ${smartMoney.net_flow_direction}.` : social.sentiment ? `Social sentiment: ${social.sentiment}.` : 'Social and smart-money context should be reviewed manually.',
    ];

    const verifyNext = [
      'Open cluster graph and inspect high-risk connected wallets.',
      'Verify LP lock, mint authority, and freeze authority on-chain.',
      'Compare social hype against holder growth and recent sell pressure.',
    ];

    return { whyRisky, signalsMatter, verifyNext };
  }
  private deterministicExplanation(data: ScanExplanationInput): string {
    const { finalScore, decision, clusterRisk, velocityScore, basicOnchain } = data;
    const priceChangeH1 = data.rawData?.velocity?.price_change_h1;
    const rugRisks = data.rawData?.tokenMetadata?.rug_risks ?? [];
    const riskLevel = finalScore >= 75 ? 'CRITICAL' : finalScore >= 50 ? 'HIGH' : finalScore >= 30 ? 'MEDIUM' : 'LOW';
    const parts = [`Risk score: ${finalScore.toFixed(1)}/100 (${riskLevel}).`];

    if (decision === 'BLOCKED') parts.push('This token is blocked by your risk settings.');
    if (typeof priceChangeH1 === 'number' && priceChangeH1 <= -50) parts.push(`Price collapsed ${Math.abs(priceChangeH1).toFixed(0)}% in the last hour, which is a severe bearish signal.`);
    if (basicOnchain >= 65) parts.push(`On-chain risk is elevated (${basicOnchain.toFixed(0)}).`);
    if (Array.isArray(rugRisks) && rugRisks.length > 0) parts.push(`RugCheck flags: ${rugRisks.slice(0, 2).join(', ')}.`);
    if (clusterRisk > 60) parts.push(`Cluster risk is elevated (${clusterRisk.toFixed(0)}).`);
    if (velocityScore > 60) parts.push(`Velocity is abnormal (${velocityScore.toFixed(0)}), likely volatility or exit-liquidity risk rather than bullish momentum.`);

    return parts.join(' ');
  }
}

export interface ParsedIntent {
  action: 'SCAN' | 'BUY' | 'SETTINGS' | 'WATCHLIST';
  token_address: string | null;
  token_symbol: string | null;
  amount_sol: number | null;
  settings: Record<string, any> | null;
}

export interface ScanSummary {
  whyRisky: string[];
  signalsMatter: string[];
  verifyNext: string[];
}

export interface ScanExplanationInput {
  tokenSymbol: string;
  tokenAddress: string;
  finalScore: number;
  clusterRisk: number;
  velocityScore: number;
  smartMoney: number;
  basicOnchain: number;
  decision: string;
  rawData: Record<string, any>;
}
