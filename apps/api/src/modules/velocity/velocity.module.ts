import { Module } from '@nestjs/common';
import { VelocityService } from './velocity.service';

@Module({
  providers: [VelocityService],
  exports: [VelocityService],
})
export class VelocityModule {}
