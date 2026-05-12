import { Module } from '@nestjs/common';
import { ClusterService } from './cluster.service';
import { HeliusModule } from '../../providers/helius/helius.module';

@Module({
  imports: [HeliusModule],
  providers: [ClusterService],
  exports: [ClusterService],
})
export class ClusterModule {}
