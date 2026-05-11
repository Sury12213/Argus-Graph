import { IsOptional, IsString, IsInt, IsBoolean, Min, Max } from 'class-validator';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxRiskScore?: number;

  @IsOptional()
  @IsBoolean()
  autoExitEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  slippageBps?: number;
}
