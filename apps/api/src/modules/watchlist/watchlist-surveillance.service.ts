import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { ScanService } from '../scan/scan.service';
import { TelegramService } from '../scan/telegram.service';
import { RedisService } from '../../providers/redis/redis.service';

type WatchlistItemWithUser = {
  id: string;
  userId: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  user: { telegramChatId: string | null };
};

@Injectable()
export class WatchlistSurveillanceService implements OnModuleInit {
  private readonly logger = new Logger(WatchlistSurveillanceService.name);
  private readonly intervalMs: number;
  private readonly enabled: boolean;
  private readonly alertCooldownSeconds: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private scan: ScanService,
    private telegram: TelegramService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.intervalMs = Number(this.config.get<string>('WATCHLIST_SCAN_INTERVAL_MS') ?? 5 * 60 * 1000);
    this.enabled = this.config.get<string>('WATCHLIST_SURVEILLANCE_ENABLED') === 'true';
    this.alertCooldownSeconds = Number(this.config.get<string>('WATCHLIST_ALERT_COOLDOWN_SECONDS') ?? 60 * 60);
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Watchlist surveillance disabled');
      return;
    }

    this.logger.log(`Watchlist surveillance enabled (${this.intervalMs}ms interval)`);
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
  }

  async runOnce() {
    const lockKey = 'watchlist_surveillance:runner';
    const lockToken = await this.redis.acquireLock(lockKey, Math.ceil(this.intervalMs / 1000) + 30);
    if (!lockToken) return;

    try {
      const items = await this.prisma.watchlist.findMany({
        where: { alertEnabled: true, user: { telegramChatId: { not: null } } },
        include: { user: true },
        take: 50,
        orderBy: { createdAt: 'asc' },
      }) as WatchlistItemWithUser[];
      const groups = this.groupItemsByToken(items);

      for (const [tokenAddress, tokenItems] of groups) {
        await this.scanTokenForWatchers(tokenAddress, tokenItems).catch((error) => {
          this.logger.warn(`Watchlist scan failed for ${tokenAddress}: ${error.message}`);
        });
      }
    } finally {
      await this.redis.releaseLock(lockKey, lockToken);
    }
  }

  private groupItemsByToken(items: WatchlistItemWithUser[]): Map<string, WatchlistItemWithUser[]> {
    const groups = new Map<string, WatchlistItemWithUser[]>();
    for (const item of items) {
      const key = this.normalizeTokenKey(item.tokenAddress);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return groups;
  }

  private async scanTokenForWatchers(tokenKey: string, items: WatchlistItemWithUser[]) {
    const firstItem = items[0];
    if (!firstItem) return;

    const cacheKey = `watchlist_surveillance:scan_result:${tokenKey}`;
    let result = await this.redis.cacheGet<any>(cacheKey);

    if (!result) {
      const lockKey = `watchlist_surveillance:token:${tokenKey}`;
      const lockToken = await this.redis.acquireLock(lockKey, Math.ceil(this.intervalMs / 1000) + 30);
      if (!lockToken) {
        result = await this.redis.cacheGet<any>(cacheKey);
        if (!result) {
          this.logger.debug(`Skipping ${tokenKey}; token scan lock is active and no cached result exists`);
          return;
        }
      } else {
        try {
          result = await this.redis.cacheGet<any>(cacheKey);
          if (!result) {
            result = await this.scan.executeScan(
              firstItem.userId,
              firstItem.tokenAddress,
              `watchlist-token-${tokenKey}-${Math.floor(Date.now() / this.intervalMs)}`,
              'WATCHLIST',
            );
            await this.redis.cacheSet(cacheKey, result, Math.max(30, Math.floor(this.intervalMs / 1000)));
          }
        } finally {
          await this.redis.releaseLock(lockKey, lockToken);
        }
      }
    }

    for (const item of items) {
      await this.evaluateWatchlistAlert(item, result).catch((error) => {
        this.logger.warn(`Watchlist alert evaluation failed for ${item.id}: ${error.message}`);
      });
    }
  }

  private async evaluateWatchlistAlert(item: WatchlistItemWithUser, result: any) {
    const previousScan = await this.prisma.scan.findFirst({
      where: {
        userId: item.userId,
        tokenAddress: item.tokenAddress,
        source: 'WATCHLIST',
        id: { not: result.id },
      },
      orderBy: { createdAt: 'desc' },
      select: { finalScore: true, decision: true, rawData: true },
    });

    const dangerTriggers = this.extractDangerTriggers(result);
    const previousTriggers = previousScan ? this.extractDangerTriggers({
      engines: {
        cluster: (previousScan.rawData as any)?.cluster,
        velocity: (previousScan.rawData as any)?.velocity,
        smart_money: (previousScan.rawData as any)?.smartMoney,
      },
      scores: (previousScan.rawData as any)?.scoring,
    }) : [];
    const newDangerTriggers = dangerTriggers.filter((trigger) => !previousTriggers.includes(trigger));
    const riskDelta = result.scores.final - (previousScan?.finalScore ?? result.scores.final);
    const becameBlocked = previousScan?.decision !== 'BLOCKED' && result.decision.decision === 'BLOCKED';
    const alertPayload = {
      token: { address: item.tokenAddress, symbol: item.tokenSymbol ?? result.token.symbol },
      scores: {
        final: result.scores.final,
        risk_level: result.scores.risk_level,
        cluster_risk: result.scores.cluster_risk,
        smart_money: result.scores.smart_money,
        velocity_score: result.scores.velocity_score,
        basic_onchain: result.scores.basic_onchain,
      },
      decision: result.decision.decision,
      triggers: [
        ...newDangerTriggers,
        riskDelta >= 20 ? `Risk score increased by ${riskDelta.toFixed(1)} points.` : null,
        becameBlocked ? 'Decision changed to BLOCKED.' : null,
      ].filter(Boolean) as string[],
      chatId: item.user.telegramChatId ?? undefined,
    };

    if (!becameBlocked && riskDelta < 20 && newDangerTriggers.length === 0) return;

    const signalHash = [
      result.decision.decision,
      Math.round(result.scores.final),
      dangerTriggers.slice().sort().join('|'),
      Math.floor(Math.max(0, riskDelta) / 10) * 10,
    ].join(':');
    const cooldownKey = `watchlist_alert:${item.id}:${signalHash}`;
    const canAlert = await this.redis.acquireLock(cooldownKey, this.alertCooldownSeconds);
    if (!canAlert) return;

    await this.telegram.sendScanAlert(alertPayload);
  }

  private normalizeTokenKey(tokenAddress: string): string {
    return tokenAddress.trim().toLowerCase();
  }

  private extractDangerTriggers(result: any): string[] {
    return this.telegram.buildTriggers({
      engines: {
        cluster: result.engines.cluster,
        velocity: result.engines.velocity,
        smart_money: result.engines.smart_money,
      },
      scores: result.scores,
    });
  }
}
