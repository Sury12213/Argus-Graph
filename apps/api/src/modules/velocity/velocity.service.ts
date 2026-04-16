import { Injectable, Logger } from '@nestjs/common';
import { HeliusService } from '../../providers/helius/helius.service';
import { RedisService } from '../../providers/redis/redis.service';

/**
 * 🐦 Velocity Engine — Time-series Delta Analytics
 *
 * Measures growth SPEED (not just current state):
 * - Tweet velocity: tweet growth rate vs unique user growth
 * - Holder momentum: holder count growth vs volume
 * - Flags: BOT_PUMP, DUMP_RISK, HEALTHY
 *
 * Uses Redis for time-series data storage.
 * Output: velocity_score (0-100, higher = riskier)
 */
@Injectable()
export class VelocityService {
  private readonly logger = new Logger(VelocityService.name);

  constructor(
    private helius: HeliusService,
    private redis: RedisService,
  ) {}

  async analyze(tokenAddress: string): Promise<VelocityAnalysisResult> {
    this.logger.debug(`Analyzing velocity for ${tokenAddress}`);

    const velocityData = await this.helius.getVelocityData(tokenAddress);
    const { tweet_snapshots, holder_snapshots } = velocityData;

    // Calculate tweet velocity
    const tweetVelocity = this.calculateTweetVelocity(tweet_snapshots);

    // Calculate holder momentum
    const holderMomentum = this.calculateHolderMomentum(holder_snapshots);

    // Detect anomalies
    const flags = this.detectFlags(tweetVelocity, holderMomentum, tweet_snapshots);

    // Store latest data points in Redis for future delta comparisons
    await this.storeTimeSeries(tokenAddress, tweet_snapshots, holder_snapshots);

    // Calculate final velocity risk score
    const velocityScore = this.calculateVelocityScore(
      tweetVelocity,
      holderMomentum,
      flags,
    );

    return {
      velocity_score: Math.min(100, Math.max(0, velocityScore)),
      tweet_velocity: tweetVelocity,
      holder_momentum: holderMomentum,
      flags,
      snapshots: {
        tweets: tweet_snapshots,
        holders: holder_snapshots,
      },
    };
  }

  // ── Tweet Velocity ──

  private calculateTweetVelocity(snapshots: TweetSnapshot[]): TweetVelocityData {
    if (snapshots.length < 2) {
      return { growth_rate: 0, unique_user_rate: 0, bot_ratio: 0 };
    }

    const oldest = snapshots[0];
    const latest = snapshots[snapshots.length - 1];
    const timeDeltaMin = (latest.timestamp - oldest.timestamp) / 60000;

    if (timeDeltaMin === 0) {
      return { growth_rate: 0, unique_user_rate: 0, bot_ratio: 0 };
    }

    const growth_rate = ((latest.count - oldest.count) / oldest.count) * 100;
    const unique_user_rate =
      ((latest.unique_users - oldest.unique_users) / oldest.unique_users) * 100;

    // Bot ratio: if tweets grow much faster than unique users
    const bot_ratio =
      unique_user_rate > 0 ? growth_rate / unique_user_rate : growth_rate > 0 ? 100 : 0;

    return { growth_rate, unique_user_rate, bot_ratio };
  }

  // ── Holder Momentum ──

  private calculateHolderMomentum(snapshots: HolderSnapshot[]): HolderMomentumData {
    if (snapshots.length < 2) {
      return { growth_rate: 0, is_declining: false };
    }

    const oldest = snapshots[0];
    const latest = snapshots[snapshots.length - 1];

    const growth_rate =
      oldest.count > 0 ? ((latest.count - oldest.count) / oldest.count) * 100 : 0;

    // Check if momentum is declining (comparing last two intervals)
    let is_declining = false;
    if (snapshots.length >= 3) {
      const mid = snapshots[Math.floor(snapshots.length / 2)];
      const firstHalfRate = (mid.count - oldest.count) / Math.max(1, oldest.count);
      const secondHalfRate = (latest.count - mid.count) / Math.max(1, mid.count);
      is_declining = secondHalfRate < firstHalfRate * 0.5;
    }

    return { growth_rate, is_declining };
  }

  // ── Anomaly Detection ──

  private detectFlags(
    tweetVelocity: TweetVelocityData,
    holderMomentum: HolderMomentumData,
    tweetSnapshots: TweetSnapshot[],
  ): VelocityFlag[] {
    const flags: VelocityFlag[] = [];

    // BOT_PUMP: tweets spiking but unique users flat
    if (tweetVelocity.growth_rate > 200 && tweetVelocity.bot_ratio > 5) {
      flags.push({
        type: 'BOT_PUMP',
        severity: 'HIGH',
        description: `Tweet count grew ${tweetVelocity.growth_rate.toFixed(0)}% but unique users barely changed. Likely bot-driven hype.`,
      });
    }

    // DUMP_RISK: holder count declining while volume might be up
    if (holderMomentum.is_declining) {
      flags.push({
        type: 'DUMP_RISK',
        severity: 'MEDIUM',
        description: `Holder growth momentum is declining. Possible silent dump in progress.`,
      });
    }

    // ORGANIC: healthy organic growth
    if (
      tweetVelocity.bot_ratio < 2 &&
      tweetVelocity.growth_rate > 0 &&
      holderMomentum.growth_rate > 0 &&
      !holderMomentum.is_declining
    ) {
      flags.push({
        type: 'HEALTHY',
        severity: 'LOW',
        description: 'Organic growth detected. Tweet velocity and holder momentum are aligned.',
      });
    }

    return flags;
  }

  // ── Redis Time-series Storage ──

  private async storeTimeSeries(
    tokenAddress: string,
    tweets: TweetSnapshot[],
    holders: HolderSnapshot[],
  ) {
    const latest = tweets[tweets.length - 1];
    if (latest) {
      await this.redis.addTimeSeriesPoint(
        'tweet_count',
        tokenAddress,
        latest.count,
        latest.timestamp,
      );
      await this.redis.addTimeSeriesPoint(
        'tweet_unique',
        tokenAddress,
        latest.unique_users,
        latest.timestamp,
      );
    }

    const latestHolder = holders[holders.length - 1];
    if (latestHolder) {
      await this.redis.addTimeSeriesPoint(
        'holder_count',
        tokenAddress,
        latestHolder.count,
        latestHolder.timestamp,
      );
    }
  }

  // ── Score Calculation ──

  private calculateVelocityScore(
    tweet: TweetVelocityData,
    holder: HolderMomentumData,
    flags: VelocityFlag[],
  ): number {
    let score = 0;

    // Bot ratio penalty
    if (tweet.bot_ratio > 10) score += 40;
    else if (tweet.bot_ratio > 5) score += 25;
    else if (tweet.bot_ratio > 2) score += 10;

    // Declining holder momentum
    if (holder.is_declining) score += 20;
    if (holder.growth_rate < 0) score += 15;

    // Flag-based penalties
    for (const flag of flags) {
      if (flag.type === 'BOT_PUMP') score += 20;
      if (flag.type === 'DUMP_RISK') score += 15;
      if (flag.type === 'HEALTHY') score -= 10;
    }

    return Math.round(score);
  }
}

// ── Types ──

interface TweetSnapshot {
  timestamp: number;
  count: number;
  unique_users: number;
}

interface HolderSnapshot {
  timestamp: number;
  count: number;
}

interface TweetVelocityData {
  growth_rate: number;
  unique_user_rate: number;
  bot_ratio: number;
}

interface HolderMomentumData {
  growth_rate: number;
  is_declining: boolean;
}

interface VelocityFlag {
  type: 'BOT_PUMP' | 'DUMP_RISK' | 'HEALTHY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
}

export interface VelocityAnalysisResult {
  velocity_score: number;
  tweet_velocity: TweetVelocityData;
  holder_momentum: HolderMomentumData;
  flags: VelocityFlag[];
  snapshots: {
    tweets: TweetSnapshot[];
    holders: HolderSnapshot[];
  };
}
