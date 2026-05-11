import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import type { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../../providers/redis/redis.service';

/**
 * Social Scraper — Real Tweet Velocity Analytics
 *
 * Primary source: RapidAPI twitter-api45 (free tier: 500 req/month)
 *   → Get RAPIDAPI_KEY from: https://rapidapi.com/alexanderxbx/api/twitter-api45
 *   → Free tier = 500 requests/month
 *
 * Implements the EXACT original spec:
 *   • tweet_growth_rate  — tweets per minute window
 *   • unique_users       — count of distinct author_ids
 *   • bot_ratio          = tweet_rate / unique_user_rate
 *   → BOT_PUMP if tweets +300% but unique_users flat
 *
 * Graceful fallback: if no API key or rate limited → returns null
 * (VelocityService falls back to DexScreener tx_velocity proxy)
 */
@Injectable()
export class SocialScraperService {
  private readonly logger = new Logger(SocialScraperService.name);
  private readonly rapidApiKey: string;
  private readonly enabled: boolean;
  private readonly inFlight = new Map<string, Promise<TweetVelocityData | null>>();

  // Redis window = how long we label the comparison interval (15min display window)
  private static readonly WINDOW_MINUTES = 15;
  // Prev snapshot TTL: keep for 24h so scans spaced hours apart still work
  // (WINDOW_MINUTES was mistakenly used as TTL, causing first-scan loop every 15min)
  private static readonly SNAPSHOT_TTL_SECONDS = 86400; // 24 hours

  constructor(
    private http: HttpService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.rapidApiKey = this.config.get<string>('RAPIDAPI_KEY') ?? '';
    this.enabled = !!this.rapidApiKey;
    if (this.enabled) {
      this.logger.log('Social Scraper enabled (RapidAPI twitter-api45)');
    } else {
      this.logger.warn('Social Scraper disabled — set RAPIDAPI_KEY env var');
    }
  }

  /**
   * Fetch tweet velocity data for a token.
   * Returns null if API unavailable (velocity engine uses fallback).
   */
  async getTweetVelocity(tokenSymbol: string, tokenAddress: string): Promise<TweetVelocityData | null> {
    if (!this.enabled) return null;

    const cacheKey = `tweets:${tokenAddress}`;
    const cached = await this.redis.cacheGet<TweetVelocityData>(cacheKey);
    if (cached) {
      this.logger.debug(`[SOCIAL] Cache hit for ${tokenSymbol}`);
      return cached;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      this.logger.debug(`[SOCIAL] Reusing in-flight request for ${tokenSymbol}`);
      return pending;
    }

    const request = this.fetchTweetVelocity(tokenSymbol, tokenAddress, cacheKey)
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchTweetVelocity(tokenSymbol: string, tokenAddress: string, cacheKey: string): Promise<TweetVelocityData | null> {
    try {
      // Request a larger sample because viral meme tokens need enough tweets for stable bot-ratio and KOL detection.
      // RapidAPI free tiers may cap the response below this value; downstream metrics use the returned sample size.
      const query = encodeURIComponent(`$${tokenSymbol}`);
      const TWEET_LIMIT = 50;

      const res = await firstValueFrom(
        this.http.get(
          `https://twitter-api45.p.rapidapi.com/search.php?query=${query}&count=${TWEET_LIMIT}&type=Latest`,
          {
            headers: {
              'x-rapidapi-host': 'twitter-api45.p.rapidapi.com',
              'x-rapidapi-key': this.rapidApiKey!,
            },
            timeout: 5000,
          } as any,
        ),
      ) as AxiosResponse<any>;

      // twitter-api45 returns { timeline: [...], status: 'ok' }
      const tweets: any[] = res.data?.timeline ?? res.data?.tweets ?? [];
      if (!tweets.length) {
        this.logger.debug(`[SOCIAL] No tweets found for $${tokenSymbol}`);
        return null;
      }

      // Parse current snapshot + build instant timeline from tweet timestamps
      const now = Date.now();
      const currentSnapshot: TweetSnapshot = {
        timestamp: now,
        count: tweets.length,
        unique_users: new Set(
          tweets.map((t: any) =>
            t.screen_name ??
            t.user_info?.rest_id ??
            t.author_id ??
            t.id,
          ),
        ).size,
      };

      // KOL metrics use author follower counts and verification status returned by twitter-api45.
      const kolMetrics = this.extractKOLMetrics(tweets);

      // Engagement metrics use favorite and retweet counts to spot fading attention.
      const engagementMetrics = this.extractEngagement(tweets, now);

      // Build instant tweet histogram from created_at timestamps
      const tweetTimeline = this.buildTweetHistogram(tweets, now);

      this.logger.debug(
        `[SOCIAL] $${tokenSymbol}: ${currentSnapshot.count} tweets, ${currentSnapshot.unique_users} unique, ` +
        `KOLs=${kolMetrics.kol_count}, engagement=${engagementMetrics.total_engagement}, decay=${engagementMetrics.engagement_decay_pct.toFixed(0)}%`,
      );

      // Load previous snapshot from Redis for delta calculation
      const prevKey = `tweets_prev:${tokenAddress}`;
      const prevSnapshot = await this.redis.cacheGet<TweetSnapshot>(prevKey);

      // Keep the previous snapshot for 24h so scans more than 15 minutes apart still produce velocity deltas.
      await this.redis.cacheSet(prevKey, currentSnapshot, SocialScraperService.SNAPSHOT_TTL_SECONDS);

      // Calculate velocity (now includes KOL + engagement data)
      const velocity = this.calculateVelocity(prevSnapshot, currentSnapshot, tweetTimeline, kolMetrics, engagementMetrics);

      // Cache for 60 seconds because meme-token proxy data becomes stale quickly.
      await this.redis.cacheSet(cacheKey, velocity, 60);

      // Cache raw tweets for AI sentiment analysis (separate key, 5min TTL)
      const rawTweetKey = `tweets_raw:${tokenAddress}`;
      await this.redis.cacheSet(rawTweetKey, tweets.slice(0, 50), 300); // top 50 tweets, 5min

      return velocity;
    } catch (error: any) {
      this.logger.warn(`[SOCIAL] RapidAPI failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get cached raw tweets for a token (for AI sentiment analysis).
   * Returns null if no tweets cached (API not called yet or cache expired).
   */
  async getLastRawTweets(tokenAddress: string): Promise<any[] | null> {
    const rawTweetKey = `tweets_raw:${tokenAddress}`;
    return this.redis.cacheGet<any[]>(rawTweetKey);
  }

  // Tweet histogram buckets recent tweets into 30-minute windows for instant velocity charts.
  private buildTweetHistogram(tweets: any[], nowMs: number): { time: string; count: number }[] {
    const buckets = new Map<number, number>();
    const BUCKET_MS = 30 * 60 * 1000;
    const MAX_HOURS = 6;

    for (const tweet of tweets) {
      const createdAt = tweet.created_at ? new Date(tweet.created_at).getTime() : null;
      if (!createdAt || isNaN(createdAt)) continue;
      const ageMs = nowMs - createdAt;
      const ageBuckets = Math.floor(ageMs / BUCKET_MS);
      if (ageBuckets < 0 || ageBuckets >= MAX_HOURS * 2) continue;
      buckets.set(ageBuckets, (buckets.get(ageBuckets) ?? 0) + 1);
    }

    if (buckets.size === 0) return [];
    return Array.from(buckets.entries())
      .sort(([a], [b]) => b - a)
      .map(([bucket, count]) => ({
        time: bucket === 0 ? 'Now' : `-${bucket * 30}m`,
        count,
      }));
  }

  // KOL detection deduplicates authors so repeated tweets from one account do not inflate coordinated-shill risk.
  // weighted_shill_reach sums unique KOL followers to separate small shill waves from large influencer campaigns.
  private extractKOLMetrics(tweets: any[]): KOLMetrics {
    const seenUsers = new Set<string>();
    let kolCount = 0;
    let totalFollowers = 0;
    let totalUsers = 0;
    let weightedShillReach = 0;   // total reach of KOLs only
    const kolNames: string[] = [];

    for (const t of tweets) {
      const followers = t.user_info?.followers_count ?? t.followers_count ?? 0;
      const verified = t.user_info?.is_blue_verified ?? t.is_blue_verified ?? false;
      const name = t.screen_name ?? t.user_info?.screen_name ?? t.id ?? 'unknown';

      // Count each author once so one noisy account cannot inflate KOL reach.
      if (seenUsers.has(name)) continue;
      seenUsers.add(name);
      totalUsers++;
      totalFollowers += followers;

      // KOL tiers:
      const isTier1 = verified && followers >= 50000;
      const isTier2 = !isTier1 && (followers >= 10000 || (verified && followers >= 1000));
      if (isTier1 || isTier2) {
        kolCount++;
        weightedShillReach += followers;
        const tier = isTier1 ? 'T1' : 'T2';
        kolNames.push(`@${name} (${this.formatFollowers(followers)} ${tier})`);
      }
    }

    const avgFollowers = totalUsers > 0 ? Math.round(totalFollowers / totalUsers) : 0;
    const kolPct = totalUsers > 0 ? kolCount / totalUsers : 0;
    // Require multiple KOLs and a mixed audience; otherwise a tiny all-KOL sample looks coordinated by accident.
    const isOrganizedShill = kolCount >= 3 && kolPct < 0.8;

    // Classify shill size by combined unique KOL reach: MICRO <100K, MID 100K-1M, MEGA >1M.
    const shillSize = weightedShillReach > 1_000_000 ? 'MEGA'
      : weightedShillReach > 100_000 ? 'MID'
      : kolCount > 0 ? 'MICRO'
      : 'NONE';

    return {
      kol_count: kolCount,
      kol_names: kolNames.slice(0, 5),
      avg_followers: avgFollowers,
      is_organized_shill: isOrganizedShill,
      weighted_shill_reach: weightedShillReach,
      shill_size: shillSize,
    };
  }

  private extractEngagement(tweets: any[], nowMs: number): EngagementMetrics {
    let totalEngagement = 0;
    let recentEngagement = 0;
    let olderEngagement = 0;
    let recentCount = 0;
    let olderCount = 0;

    const POSITIVE_WORDS = /\b(moon|gem|bullish|buy|lfg|pump|alpha|gm|goat|based|fire|launch|degen)\b/gi;
    const NEGATIVE_WORDS = /\b(rug|scam|dump|sell|exit|dead|crash|honeypot|avoid|warning|beware|slow|rugged)\b/gi;
    let positiveSignals = 0;
    let negativeSignals = 0;

    for (const t of tweets) {
      const likes = t.favorite_count ?? t.favorites ?? 0;
      const rts = t.retweet_count ?? t.retweets ?? 0;
      const eng = likes + rts;
      totalEngagement += eng;

      // Sentiment keyword scan on tweet text
      const text: string = t.text ?? t.full_text ?? t.tweet ?? '';
      if (text) {
        const posMatches = (text.match(POSITIVE_WORDS) ?? []).length;
        const negMatches = (text.match(NEGATIVE_WORDS) ?? []).length;
        // Weight by engagement — high-engagement negative = stronger fear signal
        positiveSignals += posMatches * (1 + Math.log1p(eng));
        negativeSignals += negMatches * (1 + Math.log1p(eng));
      }

      const createdAt = t.created_at ? new Date(t.created_at).getTime() : null;
      if (createdAt && !isNaN(createdAt)) {
        const ageMin = (nowMs - createdAt) / 60000;
        if (ageMin < 30) {
          recentEngagement += eng;
          recentCount++;
        } else if (ageMin < 120) {
          olderEngagement += eng;
          olderCount++;
        }
      }
    }

    const avgRecent = recentCount > 0 ? recentEngagement / recentCount : 0;
    const avgOlder = olderCount > 0 ? olderEngagement / olderCount : 0;

    let decayPct = 0;
    if (avgOlder > 0) {
      decayPct = ((avgRecent - avgOlder) / avgOlder) * 100;
    }
    const isDecaying = avgOlder > 5 && avgRecent < avgOlder * 0.5;

    // Twitter sentiment score: 0-100 (50 = neutral)
    const totalSignals = positiveSignals + negativeSignals;
    const twitterSentimentScore = totalSignals > 0
      ? Math.round((positiveSignals / totalSignals) * 100)
      : 50; // neutral if no keywords found
    const isSentimentNegative = twitterSentimentScore < 35; // <35% positive = fear

    return {
      total_engagement: totalEngagement,
      avg_engagement_per_tweet: tweets.length > 0 ? Math.round(totalEngagement / tweets.length) : 0,
      recent_avg_engagement: Math.round(avgRecent),
      older_avg_engagement: Math.round(avgOlder),
      engagement_decay_pct: Number(decayPct.toFixed(1)),
      is_engagement_dying: isDecaying,
      twitter_sentiment_score: twitterSentimentScore,
      is_twitter_sentiment_negative: isSentimentNegative,
    };
  }

  private formatFollowers(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return `${n}`;
  }

  // ── Delta Calculation ─────────────────────────────────────────────────────

  private calculateVelocity(
    prev: TweetSnapshot | null,
    current: TweetSnapshot,
    timeline: { time: string; count: number }[] = [],
    kol: KOLMetrics = { kol_count: 0, kol_names: [], avg_followers: 0, is_organized_shill: false, weighted_shill_reach: 0, shill_size: 'NONE' },
    engagement: EngagementMetrics = { total_engagement: 0, avg_engagement_per_tweet: 0, recent_avg_engagement: 0, older_avg_engagement: 0, engagement_decay_pct: 0, is_engagement_dying: false, twitter_sentiment_score: 50, is_twitter_sentiment_negative: false },
  ): TweetVelocityData {
    const baseResult = {
      tweet_timeline: timeline,
      kol_count: kol.kol_count,
      kol_names: kol.kol_names,
      avg_followers: kol.avg_followers,
      is_organized_shill: kol.is_organized_shill,
      weighted_shill_reach: kol.weighted_shill_reach,
      shill_size: kol.shill_size,
      total_engagement: engagement.total_engagement,
      avg_engagement_per_tweet: engagement.avg_engagement_per_tweet,
      engagement_decay_pct: engagement.engagement_decay_pct,
      is_engagement_dying: engagement.is_engagement_dying,
      twitter_sentiment_score: engagement.twitter_sentiment_score,
      is_twitter_sentiment_negative: engagement.is_twitter_sentiment_negative,
    };

    if (!prev) {
      // FIXED: First scan — no prev snapshot, so calculate bot_ratio from current snapshot.
      // Use unique_users / total_tweets ratio as absolute proxy (not delta).
      // If 10 tweets but only 2 unique users → 5 tweets/user = suspicious.
      const tweetPerUser = current.unique_users > 0 ? current.count / current.unique_users : 1;
      const firstScanBotRatio = Math.max(1, Number(tweetPerUser.toFixed(2)));
      return {
        current_count: current.count,
        current_unique: current.unique_users,
        growth_rate: 0,
        unique_user_rate: 0,
        bot_ratio: firstScanBotRatio,
        window_minutes: SocialScraperService.WINDOW_MINUTES,
        is_bot_pump: false, // can't detect pump without delta
        is_organic: firstScanBotRatio < 2,
        ...baseResult,
      };
    }

    const timeDeltaMin = (current.timestamp - prev.timestamp) / 60000;
    if (timeDeltaMin < 0.5) {
      return {
        current_count: current.count,
        current_unique: current.unique_users,
        growth_rate: 0,
        unique_user_rate: 0,
        bot_ratio: 1,
        window_minutes: timeDeltaMin,
        is_bot_pump: false,
        is_organic: true,
        ...baseResult,
      };
    }

    const growthRate = prev.count > 0
      ? ((current.count - prev.count) / prev.count) * 100
      : 0;

    const uniqueUserRate = prev.unique_users > 0
      ? ((current.unique_users - prev.unique_users) / prev.unique_users) * 100
      : 0;

    const botRatio = uniqueUserRate > 0
      ? growthRate / uniqueUserRate
      : growthRate > 50 ? 99 : 1;

    const isBotPump = growthRate > 200 && botRatio > 5;
    const isOrganic = botRatio < 2 && growthRate > 0 && uniqueUserRate > 0;

    this.logger.debug(
      `[SOCIAL] Δ${timeDeltaMin.toFixed(1)}min | growth=${growthRate.toFixed(0)}% | botRatio=${botRatio.toFixed(1)} | KOLs=${kol.kol_count} | engDecay=${engagement.engagement_decay_pct.toFixed(0)}%`,
    );

    return {
      current_count: current.count,
      current_unique: current.unique_users,
      growth_rate: Number(growthRate.toFixed(1)),
      unique_user_rate: Number(uniqueUserRate.toFixed(1)),
      bot_ratio: Number(botRatio.toFixed(2)),
      window_minutes: Number(timeDeltaMin.toFixed(1)),
      is_bot_pump: isBotPump,
      is_organic: isOrganic,
      ...baseResult,
    };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TweetSnapshot {
  timestamp: number;
  count: number;
  unique_users: number;
}

interface KOLMetrics {
  kol_count: number;              // unique KOLs (deduplicated)
  kol_names: string[];
  avg_followers: number;          // avg followers across all unique tweeters
  is_organized_shill: boolean;    // 3+ unique KOLs AND <80% of total users
  weighted_shill_reach: number;   // sum of KOL followers = total potential eyeballs
  shill_size: 'NONE' | 'MICRO' | 'MID' | 'MEGA'; // <100K / 100K-1M / >1M reach
}

interface EngagementMetrics {
  total_engagement: number;
  avg_engagement_per_tweet: number;
  recent_avg_engagement: number;
  older_avg_engagement: number;
  engagement_decay_pct: number;
  is_engagement_dying: boolean;
  // Twitter-native real-time sentiment (faster than CoinGecko)
  twitter_sentiment_score: number;       // 0-100 (50=neutral, <35=fear)
  is_twitter_sentiment_negative: boolean;
}

export interface TweetVelocityData {
  current_count: number;
  current_unique: number;
  growth_rate: number;
  unique_user_rate: number;
  bot_ratio: number;
  window_minutes: number;
  is_bot_pump: boolean;
  is_organic: boolean;
  tweet_timeline: { time: string; count: number }[];
  // KOL Detection (deduplicated + follower-weighted)
  kol_count: number;
  kol_names: string[];
  avg_followers: number;
  is_organized_shill: boolean;
  weighted_shill_reach: number;   // sum of KOL followers = total potential eyeballs
  shill_size: 'NONE' | 'MICRO' | 'MID' | 'MEGA';
  // Engagement Decay
  total_engagement: number;
  avg_engagement_per_tweet: number;
  engagement_decay_pct: number;
  is_engagement_dying: boolean;
  // Twitter-native Sentiment (real-time, no CoinGecko delay)
  twitter_sentiment_score: number;
  is_twitter_sentiment_negative: boolean;
}
