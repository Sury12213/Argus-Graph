import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { UserModule } from '../user/user.module';
import { ScanModule } from '../scan/scan.module';

@Module({
  imports: [UserModule, ScanModule],
  controllers: [TelegramController],
})
export class TelegramModule {}
