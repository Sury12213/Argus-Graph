import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './providers/prisma/prisma.service';
import { RedisService } from './providers/redis/redis.service';
import { HeliusService } from './providers/helius/helius.service';
import { TelegramService, ScanAlertParams } from './modules/scan/telegram.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger('HealthController');

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
    private helius: HeliusService,
    private telegram: TelegramService,
  ) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'argus-graph-api',
      version: '3.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('providers')
  async providers() {
    const [database, redis, helius] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkHelius(),
    ]);

    const providers = {
      database,
      redis,
      helius,
      groq: this.configured('GROQ_API_KEY'),
      rapidapi: this.configured('RAPIDAPI_KEY'),
      telegram: this.configuredPair('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'),
      dexscreener: { status: 'ok', mode: 'public_api' },
    };

    const degraded = Object.values(providers).some((provider: any) => provider.status !== 'ok' && provider.status !== 'configured');

    return {
      status: degraded ? 'degraded' : 'ok',
      providers,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (error: any) {
      return { status: 'error', message: error.message };
    }
  }

  private async checkRedis() {
    try {
      const client = this.redis.getClient();
      if (!client) return { status: 'degraded', mode: 'development_memory_fallback' };
      await client.ping();
      return { status: 'ok' };
    } catch (error: any) {
      return { status: 'error', message: error.message };
    }
  }

  private async checkHelius() {
    try {
      await this.helius.ping();
      return { status: 'ok' };
    } catch (error: any) {
      return { status: 'error', message: error.message };
    }
  }

  @Get('test-telegram')
  async testTelegram(@Query('token') token?: string, @Query('chatId') chatId?: string) {
    const address = token || '6qdzMx4c9rL2X3Ns3SwZ8uEo4zReDPjdXpAEmpo7pump';

    let targetChatId = chatId || undefined;
    if (!targetChatId) {
      const users = await this.prisma.user.findMany({
        where: { telegramChatId: { not: null } },
        select: { id: true, walletAddress: true, telegramChatId: true, displayName: true },
        take: 5,
      });
      if (users.length > 0) {
        targetChatId = users[0].telegramChatId!;
        this.logger.log(`[TEST] Using user ${users[0].id.slice(0, 8)} / ${users[0].displayName || users[0].walletAddress.slice(0, 8)} chatId=${targetChatId}`);
      }
    }
    if (!targetChatId) {
      targetChatId = this.config.get<string>('TELEGRAM_CHAT_ID')?.trim() || undefined;
    }
    if (!targetChatId) {
      return { status: 'error', message: 'No chatId found — no user linked Telegram in DB and TELEGRAM_CHAT_ID env is missing.' };
    }

    const fakeResult: ScanAlertParams = {
      token: { address, symbol: 'TEST' },
      scores: {
        final: 85,
        risk_level: 'CRITICAL',
        cluster_risk: 80,
        smart_money: 70,
        velocity_score: 90,
        basic_onchain: 60,
      },
      decision: 'BLOCKED',
      triggers: [
        '3 funding cluster(s) detected — wallets share the same funding source.',
        'Dev wallet is selling — elevated rug-pull risk.',
      ],
      chatId: targetChatId,
    };

    await this.telegram.sendScanAlert(fakeResult);
    this.logger.log(`[TEST] Telegram alert test sent to ${targetChatId}`);

    return { status: 'ok', sent: true, chatId: targetChatId, token: address };
  }

  private configured(key: string) {
    return this.config.get<string>(key) ? { status: 'configured' } : { status: 'missing' };
  }

  private configuredPair(first: string, second: string) {
    return this.config.get<string>(first) && this.config.get<string>(second)
      ? { status: 'configured' }
      : { status: 'missing' };
  }
}
