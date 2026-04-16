import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RequestNonceDto,
  VerifySignatureDto,
  RefreshTokenDto,
} from './dto/auth.dto';
import { ApiResponse } from '../../common/dto/api-response.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Step 1: Request a nonce for wallet to sign.
   * POST /api/v1/auth/nonce
   */
  @Post('nonce')
  async requestNonce(@Body() dto: RequestNonceDto) {
    const result = await this.authService.requestNonce(dto.walletAddress);
    return new ApiResponse(result, 'Nonce generated. Sign the message with your wallet.');
  }

  /**
   * Step 2: Verify signature and get JWT tokens.
   * POST /api/v1/auth/verify
   */
  @Post('verify')
  async verifySignature(@Body() dto: VerifySignatureDto) {
    const tokens = await this.authService.verifySignature(
      dto.walletAddress,
      dto.signature,
      dto.nonce,
    );
    return new ApiResponse(tokens, 'Authentication successful');
  }

  /**
   * Refresh access token.
   * POST /api/v1/auth/refresh
   */
  @Post('refresh')
  async refreshToken(@Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refreshTokens(dto.refreshToken);
    return new ApiResponse(tokens, 'Token refreshed');
  }
}
