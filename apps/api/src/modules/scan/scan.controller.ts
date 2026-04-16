import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ScanService } from './scan.service';
import { CreateScanDto } from './dto/scan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiResponse } from '../../common/dto/api-response.dto';

@Controller('scans')
@UseGuards(JwtAuthGuard)
export class ScanController {
  constructor(private scanService: ScanService) {}

  /**
   * Execute a new token scan.
   * POST /api/v1/scans
   * Body: { input: "scan $RUGME" | "mua 1 SOL $MEME" | "<token_address>" }
   */
  @Post()
  async createScan(@Request() req: any, @Body() dto: CreateScanDto) {
    const result = await this.scanService.executeScan(req.user.id, dto.input);
    return new ApiResponse(result, 'Scan completed');
  }

  /**
   * Get scan history.
   * GET /api/v1/scans/history?take=20
   */
  @Get('history')
  async getHistory(@Request() req: any, @Query('take') take?: string) {
    const history = await this.scanService.getScanHistory(
      req.user.id,
      take ? parseInt(take) : 20,
    );
    return new ApiResponse(history);
  }

  /**
   * Get specific scan result.
   * GET /api/v1/scans/:id
   */
  @Get(':id')
  async getScan(@Request() req: any, @Param('id') id: string) {
    const scan = await this.scanService.getScanById(id, req.user.id);
    return new ApiResponse(scan);
  }
}
