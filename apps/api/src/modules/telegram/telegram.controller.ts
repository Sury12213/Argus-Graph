import { Body, Controller, Post } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { TelegramService } from '../scan/telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(
    private userService: UserService,
    private telegram: TelegramService,
  ) {}

  @Post('webhook')
  async handleWebhook(@Body() update: any) {
    const message = update?.message;
    const text = String(message?.text ?? '').trim();
    const chatId = String(message?.chat?.id ?? '');
    const code = this.extractStartCode(text);

    if (!chatId || !code) return { ok: true };

    const linked = await this.userService.linkTelegramByCode(code, chatId);
    if (linked) {
      await this.telegram.sendAlert(
        'Telegram connected to your Argus wallet. Watchlist rug-risk alerts will be sent here.',
        chatId,
      );
    } else {
      await this.telegram.sendAlert(
        'Invalid or expired Argus link code. Generate a new code from Settings and try again.',
        chatId,
      );
    }

    return { ok: true };
  }

  private extractStartCode(text: string): string | null {
    const startMatch = text.match(/^\/start\s+([A-Z0-9]{3,64})$/i);
    if (startMatch) return startMatch[1].toUpperCase();

    const plainCode = text.match(/^([A-Z0-9]{3,64})$/i);
    return plainCode ? plainCode[1].toUpperCase() : null;
  }
}
