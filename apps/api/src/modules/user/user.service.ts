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
}
