import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GuardianExecutionService } from './guardian-execution.service';

const createService = () => {
  const prisma = {
    scan: { findFirst: vi.fn() },
    guardianExecution: { create: vi.fn() },
  };
  const user = { getUserSettings: vi.fn().mockResolvedValue({ slippageBps: 100 }) };
  const jupiter = { getQuote: vi.fn(), buildSwapTransaction: vi.fn() };
  const config = { get: vi.fn().mockReturnValue('https://api.mainnet-beta.solana.com') };
  return {
    service: new GuardianExecutionService(prisma as never, user as never, jupiter as never, config as never),
    prisma,
    jupiter,
  };
};

const validMint = 'So11111111111111111111111111111111111111112';
const otherMint = '3vH3NzuHafRNvwKKzoGTWNuLtg5Kc38BxsmfUwgPpump';

describe('GuardianExecutionService validation', () => {
  it('rejects invalid input mint', async () => {
    const { service } = createService();

    await expect(service.createQuote({
      userId: 'user-1',
      walletAddress: validMint,
      inputMint: 'not-a-mint',
      outputMint: validMint,
      amountRaw: '1000',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-positive raw amount', async () => {
    const { service } = createService();

    await expect(service.createQuote({
      userId: 'user-1',
      walletAddress: validMint,
      inputMint: validMint,
      outputMint: validMint,
      amountRaw: '0',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects token mismatch for scanned token', async () => {
    const { service, prisma } = createService();
    prisma.scan.findFirst.mockResolvedValue({ id: 'scan-1', userId: 'user-1', tokenAddress: otherMint, decision: 'APPROVED', finalScore: 20 });

    await expect(service.createQuote({
      userId: 'user-1',
      walletAddress: validMint,
      scanId: 'scan-1',
      inputMint: validMint,
      outputMint: validMint,
      amountRaw: '1000',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
