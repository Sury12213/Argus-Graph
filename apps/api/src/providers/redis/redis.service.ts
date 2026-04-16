import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Redis Service with in-memory fallback.
 *
 * When Redis is not available (Docker not running),
 * falls back to a simple Map-based in-memory cache.
 * This allows the backend to run without Docker during development.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: any = null;
  private useMemoryFallback = false;

  // In-memory fallback stores
  private memoryCache = new Map<string, { value: string; expiresAt: number }>();
  private memorySortedSets = new Map<string, Map<number, string>>();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      const Redis = (await import('ioredis')).default;
      this.client = new Redis({
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 2) {
            this.logger.warn('⚡ Redis not available — switching to in-memory fallback');
            this.useMemoryFallback = true;
            this.client?.disconnect();
            this.client = null;
            return null; // Stop retrying
          }
          return Math.min(times * 200, 1000);
        },
        connectTimeout: 3000,
        lazyConnect: true,
      });

      await this.client.connect();
      this.logger.log('⚡ Redis connected');
    } catch {
      this.logger.warn('⚡ Redis not available — using in-memory fallback (data is not persisted)');
      this.useMemoryFallback = true;
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('⚡ Redis disconnected');
    }
  }

  getClient() {
    return this.client;
  }

  // ── Time-series helpers for Velocity Engine ──

  async addTimeSeriesPoint(
    metric: string,
    tokenAddress: string,
    value: number,
    timestamp?: number,
  ): Promise<void> {
    const key = `ts:${metric}:${tokenAddress}`;
    const ts = timestamp ?? Date.now();

    if (this.useMemoryFallback) {
      if (!this.memorySortedSets.has(key)) {
        this.memorySortedSets.set(key, new Map());
      }
      this.memorySortedSets.get(key)!.set(ts, `${ts}:${value}`);
      return;
    }

    await this.client.zadd(key, ts, `${ts}:${value}`);
    await this.client.expire(key, 86400);
  }

  async getTimeSeriesRange(
    metric: string,
    tokenAddress: string,
    fromTs: number,
    toTs: number,
  ): Promise<{ timestamp: number; value: number }[]> {
    const key = `ts:${metric}:${tokenAddress}`;

    if (this.useMemoryFallback) {
      const set = this.memorySortedSets.get(key);
      if (!set) return [];
      const results: { timestamp: number; value: number }[] = [];
      for (const [score, entry] of set) {
        if (score >= fromTs && score <= toTs) {
          const [ts, val] = entry.split(':');
          results.push({ timestamp: parseInt(ts), value: parseFloat(val) });
        }
      }
      return results;
    }

    const results = await this.client.zrangebyscore(key, fromTs, toTs);
    return results.map((entry: string) => {
      const [ts, val] = entry.split(':');
      return { timestamp: parseInt(ts), value: parseFloat(val) };
    });
  }

  async cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.useMemoryFallback) {
      this.memoryCache.set(key, {
        value: JSON.stringify(value),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return;
    }

    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async cacheGet<T>(key: string): Promise<T | null> {
    if (this.useMemoryFallback) {
      const entry = this.memoryCache.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        this.memoryCache.delete(key);
        return null;
      }
      return JSON.parse(entry.value) as T;
    }

    const data = await this.client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  }
}
