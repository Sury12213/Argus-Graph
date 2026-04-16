import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, ParsedIntent } from '../../providers/gemini/gemini.service';

/**
 * AI Module — Intent Parser + Explanation
 *
 * Follows the usage policy:
 *   - Try rule-based parsing FIRST
 *   - Fallback to AI only for complex natural language
 *   - AI explanation for human-readable risk reports
 *   - AI MUST NOT calculate scores or modify decisions
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private gemini: GeminiService) {}

  /**
   * Parse user input into structured action.
   * Rule-based first, AI fallback for complex NLP.
   */
  async parseIntent(userInput: string): Promise<ParsedIntent> {
    // Step 1: Try rule-based parsing
    const ruleBased = this.ruleBasedParse(userInput);
    if (ruleBased) {
      this.logger.debug('Intent resolved by rule-based parser');
      return ruleBased;
    }

    // Step 2: Fallback to AI for complex queries
    this.logger.debug('Falling back to AI intent parser');
    return this.gemini.parseIntent(userInput);
  }

  /**
   * Generate AI explanation for scan results.
   */
  async generateExplanation(scanData: any): Promise<string> {
    return this.gemini.explainDecision(scanData);
  }

  // ── Rule-based Parser ──

  private ruleBasedParse(input: string): ParsedIntent | null {
    const lower = input.toLowerCase().trim();

    // Direct token address (32-44 base58 chars)
    const addressMatch = input.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    // Token symbol ($SYMBOL)
    const symbolMatch = input.match(/\$([A-Za-z]+)/);
    // SOL amount
    const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:SOL|sol)/i);

    // Simple command patterns
    if (/^(scan|check|audit|kiểm tra|xem)\b/i.test(lower)) {
      return {
        action: 'SCAN',
        token_address: addressMatch?.[0] ?? null,
        token_symbol: symbolMatch ? `$${symbolMatch[1].toUpperCase()}` : null,
        amount_sol: null,
        settings: null,
      };
    }

    if (/^(buy|mua|swap|long)\b/i.test(lower)) {
      return {
        action: 'BUY',
        token_address: addressMatch?.[0] ?? null,
        token_symbol: symbolMatch ? `$${symbolMatch[1].toUpperCase()}` : null,
        amount_sol: amountMatch ? parseFloat(amountMatch[1]) : null,
        settings: null,
      };
    }

    if (/^(watch|theo dõi|add watchlist)\b/i.test(lower)) {
      return {
        action: 'WATCHLIST',
        token_address: addressMatch?.[0] ?? null,
        token_symbol: symbolMatch ? `$${symbolMatch[1].toUpperCase()}` : null,
        amount_sol: null,
        settings: null,
      };
    }

    // If we have a token address or symbol, default to SCAN
    if (addressMatch || symbolMatch) {
      return {
        action: 'SCAN',
        token_address: addressMatch?.[0] ?? null,
        token_symbol: symbolMatch ? `$${symbolMatch[1].toUpperCase()}` : null,
        amount_sol: amountMatch ? parseFloat(amountMatch[1]) : null,
        settings: null,
      };
    }

    // Can't parse — let AI handle it
    return null;
  }
}
