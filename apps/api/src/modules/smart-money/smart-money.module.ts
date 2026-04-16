import { Module } from '@nestjs/common';
import { SmartMoneyService } from './smart-money.service';

@Module({
  providers: [SmartMoneyService],
  exports: [SmartMoneyService],
})
export class SmartMoneyModule {}
