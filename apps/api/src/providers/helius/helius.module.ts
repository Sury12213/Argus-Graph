import { Global, Module } from '@nestjs/common';
import { HeliusService } from './helius.service';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [HeliusService],
  exports: [HeliusService],
})
export class HeliusModule {}
