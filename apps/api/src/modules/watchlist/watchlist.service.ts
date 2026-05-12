import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { TokenResolverService } from '../token/token-resolver.service';

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    private prisma: PrismaService,
    private tokenResolver: TokenResolverService,
  ) {}

  async addToWatchlist(userId: string, tokenAddress: string, tokenSymbol?: string) {
    this.logger.debug(`Adding ${tokenAddress} to watchlist for ${userId}`);

    const resolution = await this.tokenResolver.resolve({
      token_address: tokenAddress,
      token_symbol: tokenSymbol,
      raw_input: tokenAddress,
    });

    if (resolution.status === 'AMBIGUOUS') {
      return {
        status: 'AMBIGUOUS',
        candidates: resolution.candidates,
      };
    }

    const resolved = resolution.candidates?.[0];
    const resolvedAddress = resolution.tokenAddress!;
    const resolvedSymbol = resolved?.symbol ?? tokenSymbol ?? null;

    // Upsert — don't error if already exists
    return this.prisma.watchlist.upsert({
      where: {
        userId_tokenAddress: { userId, tokenAddress: resolvedAddress },
      },
      create: {
        userId,
        tokenAddress: resolvedAddress,
        tokenSymbol: resolvedSymbol,
        alertEnabled: true,
      },
      update: {
        tokenSymbol: resolvedSymbol ?? undefined,
        alertEnabled: true,
      },
    });
  }

  async getWatchlist(userId: string) {
    const items = await this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with latest scan score for each token
    const enriched = await Promise.all(
      items.map(async (item) => {
        const lastScan = await this.prisma.scan.findFirst({
          where: { userId, tokenAddress: item.tokenAddress },
          orderBy: { createdAt: 'desc' },
          select: {
            finalScore: true,
            decision: true,
            createdAt: true,
          },
        });

        return {
          ...item,
          lastScan: lastScan ?? null,
        };
      }),
    );

    return enriched;
  }

  async removeFromWatchlist(userId: string, id: string) {
    const item = await this.prisma.watchlist.findFirst({
      where: { id, userId },
    });

    if (!item) {
      throw new NotFoundException('Watchlist item not found');
    }

    return this.prisma.watchlist.delete({ where: { id } });
  }

  async toggleAlert(userId: string, id: string) {
    const item = await this.prisma.watchlist.findFirst({
      where: { id, userId },
    });

    if (!item) {
      throw new NotFoundException('Watchlist item not found');
    }

    return this.prisma.watchlist.update({
      where: { id },
      data: { alertEnabled: !item.alertEnabled },
    });
  }
}
