import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Google Gemini AI Provider.
 *
 * Used ONLY for:
 * 1. Intent parsing (fallback when rule-based fails)
 * 2. AI explanation of scan results
 *
 * NEVER used for scoring or decision logic (per system constraints).
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private model: any = null;

  constructor(private configService: ConfigService) {
    this.initializeClient();
  }

  private async initializeClient() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'your-gemini-api-key') {
      this.logger.warn('⚠️  GEMINI_API_KEY not set — AI features will use fallback responses');
      return;
    }

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      this.logger.log('🤖 Gemini AI initialized (gemini-2.5-flash)');
    } catch (error) {
      this.logger.error(`Failed to initialize Gemini: ${error}`);
    }
  }

  /**
   * Parse user natural language input into a structured action.
   * Only called as fallback when rule-based parser can't handle the input.
   */
  async parseIntent(userInput: string): Promise<ParsedIntent> {
    if (!this.model) {
      return this.fallbackParseIntent(userInput);
    }

    try {
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

      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ParsedIntent;
      }
    } catch (error) {
      this.logger.error(`Gemini parseIntent error: ${error}`);
    }

    return this.fallbackParseIntent(userInput);
  }

  /**
   * Generate a human-readable explanation of scan results.
   * Input: structured JSON data. Output: short explanation (<100 words).
   * MUST NOT invent data — only explain what's in the input.
   */
  async explainDecision(scanData: ScanExplanationInput): Promise<string> {
    if (!this.model) {
      return this.fallbackExplanation(scanData);
    }

    try {
      const prompt = `You are a Solana token risk analyst. Based on the following STRUCTURED DATA, write a SHORT explanation (max 100 words, in Vietnamese) for the investor.

DO NOT invent any data. Only explain what is present in the input.

Scan Results:
${JSON.stringify(scanData, null, 2)}

Write a clear, actionable warning or recommendation:`;

      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      this.logger.error(`Gemini explainDecision error: ${error}`);
      return this.fallbackExplanation(scanData);
    }
  }

  // ── Fallbacks (no AI key) ──

  private fallbackParseIntent(input: string): ParsedIntent {
    const lower = input.toLowerCase();

    // Simple keyword matching
    let action: 'SCAN' | 'BUY' | 'SETTINGS' | 'WATCHLIST' = 'SCAN';
    if (lower.includes('mua') || lower.includes('buy') || lower.includes('swap')) {
      action = 'BUY';
    } else if (lower.includes('setting') || lower.includes('cài đặt')) {
      action = 'SETTINGS';
    } else if (lower.includes('watch') || lower.includes('theo dõi')) {
      action = 'WATCHLIST';
    }

    // Extract token symbol ($SYMBOL)
    const symbolMatch = input.match(/\$([A-Za-z]+)/);
    // Extract token address (base58, 32-44 chars)
    const addressMatch = input.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    // Extract SOL amount
    const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:SOL|sol)/);

    return {
      action,
      token_address: addressMatch?.[0] ?? null,
      token_symbol: symbolMatch ? `$${symbolMatch[1]}` : null,
      amount_sol: amountMatch ? parseFloat(amountMatch[1]) : null,
      settings: null,
    };
  }

  private fallbackExplanation(data: ScanExplanationInput): string {
    const { finalScore, decision, clusterRisk, velocityScore } = data;
    const riskLevel = finalScore > 70 ? 'RẤT CAO' : finalScore > 40 ? 'TRUNG BÌNH' : 'THẤP';

    let explanation = `⚠️ Điểm rủi ro: ${finalScore.toFixed(1)}/100 (${riskLevel}). `;

    if (decision === 'BLOCKED') {
      explanation += `Lệnh bị CHẶN theo cài đặt rủi ro của bạn. `;
    }

    if (clusterRisk > 60) {
      explanation += `Phát hiện cụm ví đáng ngờ (Cluster Risk: ${clusterRisk.toFixed(0)}). `;
    }

    if (velocityScore > 60) {
      explanation += `Tốc độ tăng trưởng bất thường (Velocity: ${velocityScore.toFixed(0)}). `;
    }

    return explanation.trim();
  }
}

// ── Types ──

export interface ParsedIntent {
  action: 'SCAN' | 'BUY' | 'SETTINGS' | 'WATCHLIST';
  token_address: string | null;
  token_symbol: string | null;
  amount_sol: number | null;
  settings: Record<string, any> | null;
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
