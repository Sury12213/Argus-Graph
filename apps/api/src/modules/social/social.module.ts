import { Module } from '@nestjs/common';
import { SocialService } from './social.service';
import { VelocityModule } from '../velocity/velocity.module';

@Module({
  imports: [VelocityModule],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
