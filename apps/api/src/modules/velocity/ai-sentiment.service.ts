import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../../providers/redis/redis.service';

/**
 * AI Sentiment Refinement — LLM-powered tweet analysis
 *
 * Keyword scoring is fast but misses sarcasm, irony, and context.
 * This service sends the top engaged tweets to a single configured Groq model
 * and asks for a structured sentiment summary.
 *
 * Runtime policy:
 * - Single provider: Groq
 * - Single model: AI_MODEL, defaults to llama-3.1-8b-instant
 * - No provider/model fallback chain
 * - Returns null if unavailable; scoring remains deterministic
 */
@Injectable()
export class AISentimentService {
  private readonly logger = new Logger(AISentimentService.name);
  private readonly groqKey: string;
  private readonly model: string;

  // Cache AI summary for 5min (LLM calls are expensive)
  private static readonly CACHE_TTL = 300;

  constructor(
    private http: HttpService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.groqKey = this.config.get<string>('GROQ_API_KEY') || this.config.get<string>('AI_API_KEY') || '';
    this.model = this.config.get<string>('AI_MODEL') || 'llama-3.1-8b-instant';

    this.logger.log(
      `AI Sentiment ${this.groqKey ? 'enabled' : 'disabled'} — Provider: Groq, Model: ${this.model}`,
    );
  }

  async analyzeSentiment(
    tweets: any[],
    tokenSymbol: string,
    keywordScore: number,
    context: AISentimentContext = {},
    tokenAddress?: string,
  ): Promise<AISentimentResult | null> {
    if (!tweets || tweets.length === 0 || !this.groqKey) return null;

    const crashBucket = typeof context.price_change_h1 === 'number' && context.price_change_h1 <= -50 ? 'crash' : 'normal';
    const cacheSubject = tokenAddress ?? tokenSymbol;
    const cacheKey = `ai_sentiment_en:${cacheSubject}:${crashBucket}`;
    const cached = await this.redis.cacheGet<AISentimentResult>(cacheKey);
    if (cached) return cached;

    try {
      const topTweets = this.selectTopTweets(tweets, 10);
      if (topTweets.length < 3) {
        this.logger.debug(`[AI] Not enough tweets for ${tokenSymbol} (${topTweets.length})`);
        return null;
      }

      const prompt = this.buildPrompt(topTweets, tokenSymbol, keywordScore, context);
      const result = this.applyMarketOverrides(await this.callGroq(prompt), context);

      if (!result) {
        this.logger.warn('[AI] Groq sentiment request failed');
        return null;
      }

      this.logger.debug(
        `[AI] $${tokenSymbol}: ${result.sentiment} (${result.confidence}% conf) — "${result.summary}"` +
        (result.sarcasm_detected ? ' SARCASM' : ''),
      );

      await this.redis.cacheSet(cacheKey, result, AISentimentService.CACHE_TTL);
      return result;
    } catch (error: any) {
      this.logger.warn(`[AI] Failed: ${error.message}`);
      return null;
    }
  }

  // ── Single Provider: Groq ───────────────────────────────────────────────────

  private async callGroq(prompt: string): Promise<AISentimentResult | null> {
    try {
      const res = await firstValueFrom(
        this.http.post('https://api.groq.com/openai/v1/chat/completions', {
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a crypto sentiment analyst. Always respond with valid JSON only, no markdown. All user-facing string values MUST be written in English only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }, {
          headers: {
            'Authorization': `Bearer ${this.groqKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }),
      );

      const text = (res as any).data?.choices?.[0]?.message?.content;
      return text ? this.parseResponse(text) : null;
    } catch (err: any) {
      const status = err.response?.status;
      this.logger.warn(`[AI] Groq/${this.model}: ${status ?? 'ERR'} ${(err.message ?? '').slice(0, 80)}`);
      return null;
    }
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private buildPrompt(topTweets: any[], tokenSymbol: string, keywordScore: number, context: AISentimentContext): string {
    const tweetTexts = topTweets.map((t, i) => {
      const likes = t.favorite_count ?? t.favorites ?? 0;
      const rts = t.retweet_count ?? t.retweets ?? 0;
      const text = (t.text ?? t.full_text ?? t.tweet ?? '').slice(0, 200);
      return `[${i + 1}] (${likes} likes, ${rts} RTs) "${text}"`;
    }).join('\n');

    return `You are a crypto sentiment analyst specializing in Solana memecoins. Analyze these ${topTweets.length} tweets about $${tokenSymbol}.

MARKET CONTEXT:
- 1h price change: ${context.price_change_h1 ?? 'unknown'}%
- 1h transactions: ${context.tx_count_h1 ?? 'unknown'}
- liquidity USD: ${context.liquidity_usd ?? 'unknown'}
- liquidity ratio: ${context.liquidity_ratio ?? 'unknown'}x

TWEETS:
${tweetTexts}

Respond in this EXACT JSON format only (no markdown, no explanation outside JSON):
{
  "sentiment": "BULLISH" or "BEARISH" or "NEUTRAL" or "MIXED",
  "confidence": 0-100,
  "summary": "1 sentence English summary of community mood, max 100 chars",
  "sarcasm_detected": true or false,
  "key_concerns": ["concern1", "concern2"],
  "dominant_narrative": "main story or angle people are discussing, in English"
}

Rules:
- If 1h price change <= -50%, sentiment MUST be BEARISH with confidence >= 85 unless tweets clearly prove recovery after the crash.
- If 1h price change <= -90%, treat it as a rug/crash context. Do not output NEUTRAL, MIXED, or BULLISH.
- Ignore unrelated ticker collisions, company news, oil prices, stock updates, sports, or non-token topics. Mark them as unrelated noise.
- Detect sarcasm/irony (e.g. "totally not a rug" = bearish despite positive words)
- Focus on what the COMMUNITY thinks, not what promoters say
- If most tweets are copy-paste shill = coordinated promotion, note this
- confidence = how sure you are of your sentiment call
- Current keyword score is ${keywordScore}/100 (50=neutral). Your analysis may disagree.
- All fields containing natural language MUST be English only.
- Do not include Vietnamese, Chinese, Korean, Japanese, Thai, or any other non-English language in summary, key_concerns, or dominant_narrative.`;
  }

  private applyMarketOverrides(result: AISentimentResult | null, context: AISentimentContext): AISentimentResult | null {
    if (typeof context.price_change_h1 !== 'number' || context.price_change_h1 > -50) return result;

    const severity = context.price_change_h1 <= -90 ? 'collapsed' : 'dropped';
    return {
      sentiment: 'BEARISH',
      confidence: Math.max(result?.confidence ?? 0, context.price_change_h1 <= -90 ? 95 : 88),
      summary: `Token ${severity} ${Math.abs(context.price_change_h1).toFixed(0)}% in 1h; social chatter is crash context, not bullish momentum.`,
      sarcasm_detected: result?.sarcasm_detected ?? false,
      key_concerns: ['Severe price crash', 'Possible rug pull or exit liquidity'],
      dominant_narrative: result?.dominant_narrative ?? 'Crash and rug-risk context.',
    };
  }

  private parseResponse(text: string): AISentimentResult | null {
    try {
      // Clean markdown wrappers if present
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned) as AISentimentResult;
      parsed.summary = this.pickEnglishSummary(parsed);
      parsed.key_concerns = this.normalizeEnglishArray(parsed.key_concerns);
      parsed.dominant_narrative = this.normalizeEnglishString(parsed.dominant_narrative, 'No dominant narrative detected.');
      if (!parsed.sentiment || !parsed.summary) return null;

      // Normalize sentiment value
      const validSentiments = ['BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED'];
      if (!validSentiments.includes(parsed.sentiment)) {
        parsed.sentiment = 'NEUTRAL' as any;
      }

      return parsed;
    } catch {
      return null;
    }
  }


  private pickEnglishSummary(parsed: Partial<AISentimentResult> & { summary_en?: string; summary_vi?: string }): string {
    const candidates = [parsed.summary, parsed.summary_en, parsed.summary_vi]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    const english = candidates.find((value) => this.isProbablyEnglish(value));
    return this.normalizeEnglishString(english ?? '', 'Community sentiment is unclear from the available tweets.');
  }

  private normalizeEnglishArray(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => this.normalizeEnglishString(value, 'Unspecified concern'))
      .filter(Boolean)
      .slice(0, 5);
  }

  private normalizeEnglishString(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed || !this.isProbablyEnglish(trimmed)) return fallback;
    return trimmed;
  }

  private isProbablyEnglish(value: string): boolean {
    // Reject common non-English accented/CJK/Thai/Hangul ranges so stale or non-compliant LLM output cannot leak to UI.
    return !/[À-ỹĀ-žƀ-ɏ一-龯ぁ-ゟ゠-ヿ가-힣ก-๿]/u.test(value);
  }

  private selectTopTweets(tweets: any[], limit: number): any[] {
    return tweets
      .filter((t) => {
        const text = t.text ?? t.full_text ?? t.tweet ?? '';
        return text.length >= 20 && !text.startsWith('RT @');
      })
      .sort((a, b) => {
        const engA = (a.favorite_count ?? a.favorites ?? 0) + (a.retweet_count ?? a.retweets ?? 0);
        const engB = (b.favorite_count ?? b.favorites ?? 0) + (b.retweet_count ?? b.retweets ?? 0);
        return engB - engA;
      })
      .slice(0, limit);
  }
}

// ── Types ──

export interface AISentimentContext {
  price_change_h1?: number;
  tx_count_h1?: number;
  liquidity_usd?: number;
  liquidity_ratio?: number;
}

export interface AISentimentResult {
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED';
  confidence: number;
  summary: string;

  sarcasm_detected: boolean;
  key_concerns: string[];
  dominant_narrative: string;
}
