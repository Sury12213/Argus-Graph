import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

/** Request a nonce for wallet signature authentication */
export class RequestNonceDto {
  @IsString()
  @IsNotEmpty()
  walletAddress: string;
}

/** Verify wallet signature and get JWT tokens */
export class VerifySignatureDto {
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @IsString()
  @IsNotEmpty()
  signature: string;

  @IsString()
  @IsNotEmpty()
  nonce: string;
}

/** JWT token pair response */
export class AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/** Refresh token request */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
