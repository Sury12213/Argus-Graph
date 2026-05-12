import { describe, expect, it, vi } from 'vitest';
import { WatchlistService } from './watchlist.service';

const createService = () => {
  const prisma = {
    watchlist: {
      upsert: vi.fn(),
    },
  };
  const tokenResolver = {
    resolve: vi.fn(),
  };
  return {
    service: new WatchlistService(prisma as never, tokenResolver as never),
    prisma,
    tokenResolver,
  };
};

describe('WatchlistService', () => {
  it('stores resolved mint address instead of raw input', async () => {
    const { service, prisma, tokenResolver } = createService();
    tokenResolver.resolve.mockResolvedValue({
      status: 'RESOLVED',
      tokenAddress: 'resolvedMint',
      candidates: [{ address: 'resolvedMint', symbol: 'ARGUS' }],
    });
    prisma.watchlist.upsert.mockResolvedValue({ id: 'item-1', tokenAddress: 'resolvedMint' });

    await service.addToWatchlist('user-1', 'raw-symbol', 'ARGUS');

    expect(prisma.watchlist.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_tokenAddress: { userId: 'user-1', tokenAddress: 'resolvedMint' } },
      create: expect.objectContaining({ tokenAddress: 'resolvedMint', tokenSymbol: 'ARGUS' }),
    }));
  });

  it('returns ambiguous candidates without saving', async () => {
    const { service, prisma, tokenResolver } = createService();
    const candidates = [{ address: 'mint-a' }, { address: 'mint-b' }];
    tokenResolver.resolve.mockResolvedValue({ status: 'AMBIGUOUS', candidates });

    await expect(service.addToWatchlist('user-1', 'ARGUS')).resolves.toEqual({
      status: 'AMBIGUOUS',
      candidates,
    });
    expect(prisma.watchlist.upsert).not.toHaveBeenCalled();
  });
});
