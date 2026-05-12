import { Module } from '@nestjs/common';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { WatchlistSurveillanceService } from './watchlist-surveillance.service';
import { TokenModule } from '../token/token.module';
import { ScanModule } from '../scan/scan.module';

@Module({
  imports: [TokenModule, ScanModule],
  controllers: [WatchlistController],
  providers: [WatchlistService, WatchlistSurveillanceService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
