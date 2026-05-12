import { describe, expect, it, vi } from 'vitest';
import { WatchlistSurveillanceService } from './watchlist-surveillance.service';

const createResult = (score = 80, decision = 'BLOCKED') => ({
  token: { symbol: 'ARGUS' },
  scores: {
    final: score,
    risk_level: score >= 75 ? 'CRITICAL' : 'HIGH',
    cluster_risk: 70,
    smart_money: 60,
    velocity_score: 75,
    basic_onchain: 40,
  },
  decision: { decision },
  engines: {
    cluster: { funding_clusters: 1, clusters: [] },
    velocity: { flags: [] },
    smart_money: {},
  },
});

const createService = () => {
  const prisma = {
    watchlist: { findMany: vi.fn() },
    scan: { findFirst: vi.fn() },
  };
  const scan = { executeScan: vi.fn() };
  const telegram = {
    buildTriggers: vi.fn(() => []),
    shouldSendScanAlert: vi.fn((payload: any) => payload.decision === 'BLOCKED' || payload.scores.final >= 75 || payload.triggers.length > 0),
    sendScanAlert: vi.fn(),
  };
  const redis = {
    acquireLock: vi.fn((_: string) => Promise.resolve('lock-token' as string | null)),
    releaseLock: vi.fn(() => Promise.resolve()),
    cacheGet: vi.fn((_: string) => Promise.resolve(null as any)),
    cacheSet: vi.fn(() => Promise.resolve()),
  };
  const config = {
    get: vi.fn((key: string) => {
      const values: Record<string, string> = {
        WATCHLIST_SCAN_INTERVAL_MS: String(5 * 60 * 1000),
        WATCHLIST_SURVEILLANCE_ENABLED: 'false',
        WATCHLIST_ALERT_COOLDOWN_SECONDS: String(60 * 60),
      };
      return values[key];
    }),
  };

  return {
    service: new WatchlistSurveillanceService(prisma as never, scan as never, telegram as never, redis as never, config as never),
    prisma,
    scan,
    telegram,
    redis,
  };
};

const item = (id: string, userId: string, tokenAddress = 'TokenMint') => ({
  id,
  userId,
  tokenAddress,
  tokenSymbol: 'TOK',
  user: { telegramChatId: `chat-${userId}` },
});

describe('WatchlistSurveillanceService', () => {
  it('scans same token once and fans out alerts to watchers', async () => {
    const { service, prisma, scan, telegram } = createService();
    prisma.watchlist.findMany.mockResolvedValue([
      item('w1', 'u1', 'TokenMint'),
      item('w2', 'u2', 'tokenmint'),
    ]);
    prisma.scan.findFirst.mockResolvedValue({ finalScore: 40, decision: 'SAFE' });
    scan.executeScan.mockResolvedValue(createResult());

    await service.runOnce();

    expect(scan.executeScan).toHaveBeenCalledTimes(1);
    expect(scan.executeScan).toHaveBeenCalledWith('u1', 'TokenMint', expect.stringContaining('watchlist-token-tokenmint-'), { suppressTelegram: true });
    expect(telegram.sendScanAlert).toHaveBeenCalledTimes(2);
    expect(telegram.sendScanAlert).toHaveBeenNthCalledWith(1, expect.objectContaining({ chatId: 'chat-u1' }));
    expect(telegram.sendScanAlert).toHaveBeenNthCalledWith(2, expect.objectContaining({ chatId: 'chat-u2' }));
  });

  it('scans different tokens separately', async () => {
    const { service, prisma, scan } = createService();
    prisma.watchlist.findMany.mockResolvedValue([
      item('w1', 'u1', 'TokenA'),
      item('w2', 'u2', 'TokenB'),
    ]);
    prisma.scan.findFirst.mockResolvedValue({ finalScore: 40, decision: 'SAFE' });
    scan.executeScan.mockResolvedValue(createResult());

    await service.runOnce();

    expect(scan.executeScan).toHaveBeenCalledTimes(2);
  });

  it('uses cached token scan result and skips executeScan', async () => {
    const { service, prisma, scan, redis, telegram } = createService();
    prisma.watchlist.findMany.mockResolvedValue([item('w1', 'u1')]);
    prisma.scan.findFirst.mockResolvedValue({ finalScore: 40, decision: 'SAFE' });
    redis.cacheGet.mockImplementation((key: string) => Promise.resolve(
      key.startsWith('watchlist_surveillance:scan_result:') ? createResult() : null,
    ));

    await service.runOnce();

    expect(scan.executeScan).not.toHaveBeenCalled();
    expect(telegram.sendScanAlert).toHaveBeenCalledTimes(1);
  });

  it('skips token when token lock is active and no cache exists', async () => {
    const { service, prisma, scan, redis, telegram } = createService();
    prisma.watchlist.findMany.mockResolvedValue([item('w1', 'u1')]);
    redis.acquireLock.mockImplementation((key: string) => Promise.resolve(
      key === 'watchlist_surveillance:runner' ? 'runner-lock' : null,
    ));

    await service.runOnce();

    expect(scan.executeScan).not.toHaveBeenCalled();
    expect(telegram.sendScanAlert).not.toHaveBeenCalled();
  });

  it('keeps cooldown per watchlist item', async () => {
    const { service, prisma, scan, redis, telegram } = createService();
    prisma.watchlist.findMany.mockResolvedValue([
      item('w1', 'u1', 'TokenMint'),
      item('w2', 'u2', 'TokenMint'),
    ]);
    prisma.scan.findFirst.mockResolvedValue({ finalScore: 40, decision: 'SAFE' });
    scan.executeScan.mockResolvedValue(createResult());
    redis.acquireLock.mockImplementation((key: string) => {
      if (key.startsWith('watchlist_alert:w1:')) return Promise.resolve(null);
      return Promise.resolve('lock-token');
    });

    await service.runOnce();

    expect(telegram.sendScanAlert).toHaveBeenCalledTimes(1);
    expect(telegram.sendScanAlert).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat-u2' }));
  });

  it('uses previous scan comparison per user', async () => {
    const { service, prisma, scan, telegram } = createService();
    prisma.watchlist.findMany.mockResolvedValue([
      item('w1', 'u1', 'TokenMint'),
      item('w2', 'u2', 'TokenMint'),
    ]);
    prisma.scan.findFirst.mockImplementation(({ where }: any) => Promise.resolve(
      where.userId === 'u1'
        ? { finalScore: 78, decision: 'BLOCKED' }
        : { finalScore: 40, decision: 'SAFE' },
    ));
    scan.executeScan.mockResolvedValue(createResult(80, 'WARNING'));
    telegram.shouldSendScanAlert.mockReturnValue(false);

    await service.runOnce();

    expect(telegram.sendScanAlert).toHaveBeenCalledTimes(1);
    expect(telegram.sendScanAlert).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat-u2' }));
  });
});
