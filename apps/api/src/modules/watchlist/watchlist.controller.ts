import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WatchlistService } from './watchlist.service';

@Controller('watchlist')
@UseGuards(JwtAuthGuard)
export class WatchlistController {
  constructor(private watchlistService: WatchlistService) {}

  @Post()
  async add(@Req() req: any, @Body() body: { tokenAddress: string; tokenSymbol?: string }) {
    const item = await this.watchlistService.addToWatchlist(
      req.user.id,
      body.tokenAddress,
      body.tokenSymbol,
    );
    return { data: item };
  }

  @Get()
  async list(@Req() req: any) {
    const items = await this.watchlistService.getWatchlist(req.user.id);
    return { data: items };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.watchlistService.removeFromWatchlist(req.user.id, id);
    return { data: { deleted: true } };
  }

  @Patch(':id/toggle')
  async toggle(@Req() req: any, @Param('id') id: string) {
    const item = await this.watchlistService.toggleAlert(req.user.id, id);
    return { data: item };
  }
}
