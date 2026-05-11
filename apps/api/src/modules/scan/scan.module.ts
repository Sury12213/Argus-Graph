import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { TelegramService } from './telegram.service';
import { ClusterModule } from '../cluster/cluster.module';
import { VelocityModule } from '../velocity/velocity.module';
import { SmartMoneyModule } from '../smart-money/smart-money.module';
import { SocialModule } from '../social/social.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DecisionModule } from '../decision/decision.module';
import { AiModule } from '../ai/ai.module';
import { UserModule } from '../user/user.module';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [
    HttpModule,
    ClusterModule,
    VelocityModule,
    SmartMoneyModule,
    SocialModule,
    ScoringModule,
    DecisionModule,
    AiModule,
    UserModule,
    TokenModule,
  ],
  controllers: [ScanController],
  providers: [ScanService, TelegramService],
  exports: [ScanService, TelegramService],
})
export class ScanModule {}
