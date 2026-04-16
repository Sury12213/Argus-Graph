import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateScanDto {
  @IsString()
  @IsNotEmpty()
  input: string; // Natural language or token address
}

export class ScanByAddressDto {
  @IsString()
  @IsNotEmpty()
  tokenAddress: string;
}
