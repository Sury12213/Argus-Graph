import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserSettingsDto } from './dto/user.dto';
import { LinkTelegramDto } from './dto/telegram.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiResponse } from '../../common/dto/api-response.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private userService: UserService) {}

  @Get('me')
  async getProfile(@Request() req: any) {
    const profile = await this.userService.getProfile(req.user.id);
    return new ApiResponse(profile);
  }

  @Get('telegram/link-code')
  async createTelegramLinkCode(@Request() req: any) {
    const result = await this.userService.createTelegramLinkCode(req.user.id);
    return new ApiResponse(result);
  }

  @Patch('telegram/link')
  async linkTelegram(
    @Request() req: any,
    @Body() dto: LinkTelegramDto & { chatId?: string },
  ) {
    const chatId = dto.chatId ?? req.headers['x-telegram-chat-id'];
    const linked = await this.userService.linkTelegram(req.user.id, dto.code, String(chatId ?? ''));
    return new ApiResponse({ linked: !!linked, profile: linked }, linked ? 'Telegram linked' : 'Invalid or expired Telegram link code');
  }

  @Patch('settings')
  async updateSettings(
    @Request() req: any,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    const updated = await this.userService.updateSettings(req.user.id, dto);
    return new ApiResponse(updated, 'Settings updated');
  }
}
