import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VelocityService } from './velocity.service';
import { SocialScraperService } from './social-scraper.service';
import { TelegramVelocityService } from './telegram-velocity.service';
import { AISentimentService } from './ai-sentiment.service';
import { HeliusModule } from '../../providers/helius/helius.module';
import { RedisModule } from '../../providers/redis/redis.module';

@Module({
  imports: [HttpModule, HeliusModule, RedisModule],
  providers: [
    VelocityService,
    SocialScraperService,
    TelegramVelocityService,
    AISentimentService,
  ],
  exports: [
    VelocityService,
    SocialScraperService,
    TelegramVelocityService,
    AISentimentService,
  ],
})
export class VelocityModule {}
