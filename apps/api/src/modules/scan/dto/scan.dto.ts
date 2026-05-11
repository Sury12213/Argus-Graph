import { IsOptional, IsString } from 'class-validator';

export class CreateScanDto {
  @IsString()
  input: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}
