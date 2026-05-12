import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../../providers/redis/redis.service';

@Injectable()
export class TelegramVelocityService {
  private readonly logger = new Logger(TelegramVelocityService.name);
  private readonly botToken: string;
  private readonly enabled: boolean;

  // Snapshot TTL: keep for 24h so scans spaced hours apart still work
  private static readonly SNAPSHOT_TTL = 86400;
  // Cache result for 2min to avoid spamming TG API
  private static readonly CACHE_TTL = 120;

  constructor(
    private http: HttpService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.enabled = !!this.botToken;
    if (this.enabled) {
      this.logger.log('Telegram Velocity enabled');
    } else {
      this.logger.warn('Telegram Velocity disabled — set TELEGRAM_BOT_TOKEN');
    }
  }

  async getTelegramVelocity(
    dexSocials: Array<{ type: string; url: string }> | null,
    tokenAddress: string,
  ): Promise<TelegramVelocityData | null> {
    if (!this.enabled) return null;

    // Check cache first
    const cacheKey = `tg_velocity:${tokenAddress}`;
    const cached = await this.redis.cacheGet<TelegramVelocityData>(cacheKey);
    if (cached) return cached;

    try {
      const tgUsername = this.extractTelegramUsername(dexSocials);
      if (!tgUsername) {
        this.logger.debug(`[TG] No Telegram group found for ${tokenAddress.slice(0, 8)}...`);
        return null;
      }

      const currentCount = await this.getChatMemberCount(tgUsername);
      if (currentCount === null) return null;

      const prevKey = `tg_prev:${tokenAddress}`;
      const prevSnapshot = await this.redis.cacheGet<TGSnapshot>(prevKey);

      const now = Date.now();
      const currentSnapshot: TGSnapshot = {
        timestamp: now,
        member_count: currentCount,
        group_username: tgUsername,
      };

      await this.redis.cacheSet(prevKey, currentSnapshot, TelegramVelocityService.SNAPSHOT_TTL);

      const result = this.calculateDelta(prevSnapshot, currentSnapshot);

      this.logger.debug(
        `[TG] @${tgUsername}: ${currentCount} members` +
        (prevSnapshot ? `, Δ${result.member_growth_rate.toFixed(1)}%` : ' (first scan)'),
      );

      await this.redis.cacheSet(cacheKey, result, TelegramVelocityService.CACHE_TTL);
      return result;

    } catch (error: any) {
      this.logger.warn(`[TG] Failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract Telegram group username from DexScreener socials array.
   * DexScreener format: { type: "telegram", url: "https://t.me/GroupName" }
   */
  private extractTelegramUsername(
    socials: Array<{ type: string; url: string }> | null,
  ): string | null {
    if (!socials || socials.length === 0) return null;

    const tgSocial = socials.find(
      (s) => s.type === 'telegram' || s.url?.includes('t.me'),
    );
    if (!tgSocial?.url) return null;

    // Parse: https://t.me/GroupName → @GroupName
    const match = tgSocial.url.match(/t\.me\/([a-zA-Z0-9_]+)/);
    return match ? `@${match[1]}` : null;
  }

  /**
   * Get chat member count via Telegram Bot API.
   * Only works for public groups/channels where bot doesn't need to be a member.
   */
  private async getChatMemberCount(chatId: string): Promise<number | null> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getChatMemberCount`;
      const res = await firstValueFrom(
        this.http.post(url, { chat_id: chatId }),
      );
      const data = (res as any).data;
      if (data?.ok && typeof data.result === 'number') {
        return data.result;
      }
      return null;
    } catch (error: any) {
      // Common error: bot can't access private groups
      if (error.response?.data?.description?.includes('chat not found')) {
        this.logger.debug(`[TG] Group ${chatId} is private or doesn't exist`);
      }
      return null;
    }
  }

  /**
   * Calculate member growth delta between two snapshots.
   */
  private calculateDelta(
    prev: TGSnapshot | null,
    current: TGSnapshot,
  ): TelegramVelocityData {
    if (!prev) {
      return {
        group_username: current.group_username,
        member_count: current.member_count,
        member_growth_rate: 0,
        member_delta: 0,
        is_member_surging: false,
        is_member_declining: false,
        scan_window_minutes: 0,
        is_first_scan: true,
      };
    }

    const timeDeltaMin = (current.timestamp - prev.timestamp) / 60000;
    const memberDelta = current.member_count - prev.member_count;
    const growthRate = prev.member_count > 0
      ? (memberDelta / prev.member_count) * 100
      : 0;

    // Surge: >5% growth in any window = sudden influx
    const isSurging = growthRate > 5 && memberDelta > 50;
    // Decline: losing >3% members = community dying
    const isDeclining = growthRate < -3 && Math.abs(memberDelta) > 20;

    return {
      group_username: current.group_username,
      member_count: current.member_count,
      member_growth_rate: Number(growthRate.toFixed(2)),
      member_delta: memberDelta,
      is_member_surging: isSurging,
      is_member_declining: isDeclining,
      scan_window_minutes: Number(timeDeltaMin.toFixed(1)),
      is_first_scan: false,
    };
  }
}

// ── Types ──

interface TGSnapshot {
  timestamp: number;
  member_count: number;
  group_username: string;
}

export interface TelegramVelocityData {
  group_username: string;
  member_count: number;
  member_growth_rate: number;   // % change since last scan
  member_delta: number;         // absolute change
  is_member_surging: boolean;   // >5% growth + >50 new members
  is_member_declining: boolean; // >3% decline + >20 lost
  scan_window_minutes: number;  // time since last scan
  is_first_scan: boolean;
}
