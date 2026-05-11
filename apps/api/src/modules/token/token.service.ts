import { Injectable, Logger } from '@nestjs/common';
import { HeliusService } from '../../providers/helius/helius.service';
import { RedisService } from '../../providers/redis/redis.service';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private helius: HeliusService,
    private redis: RedisService,
  ) {}

  async getTokenInfo(tokenAddress: string) {
    // Check cache first (5 min TTL)
    const cached = await this.redis.cacheGet(`token:${tokenAddress}`);
    if (cached) return cached;

    const metadata = await this.helius.getTokenMetadata(tokenAddress);
    if (metadata) {
      await this.redis.cacheSet(`token:${tokenAddress}`, metadata, 300);
    }
    return metadata;
  }
}
