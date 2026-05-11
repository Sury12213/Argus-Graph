import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { UpdateUserSettingsDto } from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        walletAddress: true,
        displayName: true,
        maxRiskScore: true,
        autoExitEnabled: true,
        slippageBps: true,
        telegramLinkedAt: true,
        createdAt: true,
        _count: { select: { scans: true, watchlist: true } },
      },
    });
  }

  async updateSettings(userId: string, dto: UpdateUserSettingsDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        walletAddress: true,
        displayName: true,
        maxRiskScore: true,
        autoExitEnabled: true,
        slippageBps: true,
      },
    });
  }

  async getUserSettings(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        maxRiskScore: true,
        autoExitEnabled: true,
        slippageBps: true,
      },
    });
  }
  async createTelegramLinkCode(userId: string) {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    await this.prisma.authNonce.create({
      data: {
        userId,
        wallet: `telegram:${userId}`,
        nonce: code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    return {
      code,
      botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
      deepLink: process.env.TELEGRAM_BOT_USERNAME ? `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${code}` : null,
      expiresInSeconds: 600,
    };
  }

  async linkTelegram(userId: string, code: string, chatId: string) {
    const nonce = await this.prisma.authNonce.findFirst({
      where: {
        userId,
        nonce: code.toUpperCase(),
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (!nonce) return null;

    await this.prisma.authNonce.update({
      where: { id: nonce.id },
      data: { used: true },
    });

    return (this.prisma.user as any).update({
      where: { id: userId },
      data: {
        telegramChatId: chatId,
        telegramLinkedAt: new Date(),
      },
      select: {
        id: true,
        walletAddress: true,
        telegramLinkedAt: true,
      },
    });
  }
  async linkTelegramByCode(code: string, chatId: string) {
    const nonce = await this.prisma.authNonce.findFirst({
      where: {
        nonce: code.toUpperCase(),
        wallet: { startsWith: 'telegram:' },
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (!nonce?.userId) return null;

    await this.prisma.authNonce.update({
      where: { id: nonce.id },
      data: { used: true },
    });

    return (this.prisma.user as any).update({
      where: { id: nonce.userId },
      data: {
        telegramChatId: chatId,
        telegramLinkedAt: new Date(),
      },
      select: {
        id: true,
        walletAddress: true,
        telegramLinkedAt: true,
      },
    });
  }
}
