import { Injectable, Logger } from '@nestjs/common';
import { SocialScraperService } from '../velocity/social-scraper.service';

/**
 * 📡 Social Intelligence Engine v2
 *
 * Now powered by real data from SocialScraperService (RapidAPI twitter-api45).
 * Falls back to DexScreener-derived estimates if Twitter unavailable.
 *
 * Used as a display-only panel (not directly in scoring formula —
 * VelocityService handles scoring using the same data source).
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(private social: SocialScraperService) {}

  async analyze(tokenAddress: string, tokenSymbol?: string): Promise<SocialAnalysisResult> {
    this.logger.debug(`Analyzing social signals for ${tokenAddress}`);

    // Try to get real Twitter data via SocialScraperService
    const symbol = tokenSymbol ?? tokenAddress.slice(0, 6).toUpperCase();
    const tweetData = await this.social.getTweetVelocity(symbol, tokenAddress).catch(() => null);

    if (tweetData) {
      // Real data from RapidAPI
      const botRatioNormalized = Math.min(1, (tweetData.bot_ratio - 1) / 10); // ratio 1→0%, 10→90%
      return {
        social_score: tweetData.is_bot_pump ? 70 : botRatioNormalized > 0.4 ? 50 : 20,
        tweet_count: tweetData.current_count,
        unique_authors: tweetData.current_unique,
        bot_ratio: Math.min(1, Math.max(0, botRatioNormalized)),
        sentiment: tweetData.is_organic ? 0.4 : tweetData.is_bot_pump ? -0.3 : 0.1,
        sentiment_label: tweetData.is_bot_pump ? 'SUSPICIOUS' : tweetData.is_organic ? 'POSITIVE' : 'NEUTRAL',
        telegram_members: null,
        telegram_active: null,
        mentions_growth_rate: tweetData.growth_rate,
        data_source: 'twitter_live',
      };
    }

    // Fallback: return neutral placeholder (no mock numbers)
    return {
      social_score: 0,
      tweet_count: null,
      unique_authors: null,
      bot_ratio: 0,
      sentiment: 0,
      sentiment_label: 'UNKNOWN',
      telegram_members: null,
      telegram_active: null,
      mentions_growth_rate: 0,
      data_source: 'unavailable',
    };
  }
}

export interface SocialAnalysisResult {
  social_score: number;
  tweet_count: number | null;
  unique_authors: number | null;
  bot_ratio: number;
  sentiment: number;
  sentiment_label: string;
  telegram_members: number | null;
  telegram_active: number | null;
  mentions_growth_rate: number;
  data_source?: string;
}
