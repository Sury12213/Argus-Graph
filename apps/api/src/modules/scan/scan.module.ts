import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ClusterModule } from '../cluster/cluster.module';
import { VelocityModule } from '../velocity/velocity.module';
import { SmartMoneyModule } from '../smart-money/smart-money.module';
import { SocialModule } from '../social/social.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DecisionModule } from '../decision/decision.module';
import { AiModule } from '../ai/ai.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    ClusterModule,
    VelocityModule,
    SmartMoneyModule,
    SocialModule,
    ScoringModule,
    DecisionModule,
    AiModule,
    UserModule,
  ],
  controllers: [ScanController],
  providers: [ScanService],
  exports: [ScanService],
})
export class ScanModule {}
