import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { PrismaModule } from './providers/prisma/prisma.module';
import { RedisModule } from './providers/redis/redis.module';
import { HeliusModule } from './providers/helius/helius.module';
import { LlmModule } from './providers/ai/llm.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ScanModule } from './modules/scan/scan.module';
import { TokenModule } from './modules/token/token.module';
import { ClusterModule } from './modules/cluster/cluster.module';
import { VelocityModule } from './modules/velocity/velocity.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { DecisionModule } from './modules/decision/decision.module';
import { AiModule } from './modules/ai/ai.module';
import { SmartMoneyModule } from './modules/smart-money/smart-money.module';
import { SocialModule } from './modules/social/social.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(__dirname, '..', '..', '..', '.env')],
    }),

    // Infrastructure Providers
    PrismaModule,
    RedisModule,
    HeliusModule,
    LlmModule,

    // Feature Modules
    AuthModule,
    UserModule,
    TokenModule,
    ScanModule,
    ClusterModule,
    VelocityModule,
    ScoringModule,
    DecisionModule,
    AiModule,
    SmartMoneyModule,
    SocialModule,
    WatchlistModule,
    TelegramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
