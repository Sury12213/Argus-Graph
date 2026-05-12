import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateGuardianQuoteDto {
  @IsOptional()
  @IsString()
  scanId?: string;

  @IsString()
  inputMint: string;

  @IsString()
  outputMint: string;

  @IsString()
  @Matches(/^[1-9]\d*$/)
  amountRaw: string;

  @IsOptional()
  @IsString()
  tokenAddress?: string;
}

export class BuildGuardianSwapDto {
  @IsString()
  executionId: string;
}

export class MarkGuardianSubmittedDto {
  @IsString()
  executionId: string;

  @IsString()
  transactionSignature: string;
}
