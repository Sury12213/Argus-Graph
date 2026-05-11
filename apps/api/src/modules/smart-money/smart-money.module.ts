import { Module } from '@nestjs/common';
import { SmartMoneyService } from './smart-money.service';
import { HeliusModule } from '../../providers/helius/helius.module';

@Module({
  imports: [HeliusModule],
  providers: [SmartMoneyService],
  exports: [SmartMoneyService],
})
export class SmartMoneyModule {}
