import { IsString, Length } from 'class-validator';

export class LinkTelegramDto {
  @IsString()
  @Length(3, 64)
  code: string;
}
