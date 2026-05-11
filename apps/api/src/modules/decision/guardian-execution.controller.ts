import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { GuardianExecutionService } from './guardian-execution.service';
import { BuildGuardianSwapDto, CreateGuardianQuoteDto, MarkGuardianSubmittedDto } from './dto/guardian-execution.dto';

@Controller('guardian')
@UseGuards(JwtAuthGuard)
export class GuardianExecutionController {
  constructor(private guardian: GuardianExecutionService) {}

  @Post('quote')
  async createQuote(@Request() req: any, @Body() dto: CreateGuardianQuoteDto) {
    const result = await this.guardian.createQuote({
      userId: req.user.id,
      walletAddress: req.user.walletAddress,
      scanId: dto.scanId,
      inputMint: dto.inputMint,
      outputMint: dto.outputMint,
      amountRaw: dto.amountRaw,
      tokenAddress: dto.tokenAddress,
    });
    return new ApiResponse(result, 'Guardian quote ready');
  }

  @Post('swap/build')
  async buildSwap(@Request() req: any, @Body() dto: BuildGuardianSwapDto) {
    const result = await this.guardian.buildUnsignedSwap(req.user.id, req.user.walletAddress, dto.executionId);
    return new ApiResponse(result, 'Unsigned swap transaction ready');
  }

  @Post('swap/submitted')
  async markSubmitted(@Request() req: any, @Body() dto: MarkGuardianSubmittedDto) {
    const result = await this.guardian.recordSubmittedTransaction(
      req.user.id,
      req.user.walletAddress,
      dto.executionId,
      dto.transactionSignature,
    );
    return new ApiResponse(result, 'Guardian transaction submitted');
  }

  @Get('token-balance')
  async getTokenBalance(@Request() req: any, @Query('mint') mint: string) {
    const result = await this.guardian.getTokenBalance(req.user.walletAddress, mint);
    return new ApiResponse(result);
  }

  @Get('executions')
  async list(@Request() req: any, @Query('scanId') scanId?: string) {
    const result = await this.guardian.listExecutions(req.user.id, scanId);
    return new ApiResponse(result);
  }

  @Get('executions/:id')
  async get(@Request() req: any, @Param('id') id: string) {
    const result = await this.guardian.getExecution(req.user.id, id);
    return new ApiResponse(result);
  }
}
