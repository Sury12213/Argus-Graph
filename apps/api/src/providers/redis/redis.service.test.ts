import { describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service';

const config = {
  get: vi.fn((key: string, fallback?: unknown) => {
    if (key === 'NODE_ENV') return 'development';
    if (key === 'REDIS_HOST') return '127.0.0.1';
    if (key === 'REDIS_PORT') return 0;
    return fallback;
  }),
};

const createService = async () => {
  const service = new RedisService(config as never);
  await service.onModuleInit();
  return service;
};

describe('RedisService locks', () => {
  it('prevents non-owner lock release in memory fallback', async () => {
    const service = await createService();
    const firstToken = await service.acquireLock('lock:test', 60);
    expect(firstToken).toBeTruthy();

    const secondToken = await service.acquireLock('lock:test', 60);
    expect(secondToken).toBeNull();

    await service.releaseLock('lock:test', 'wrong-token');
    expect(await service.acquireLock('lock:test', 60)).toBeNull();

    await service.releaseLock('lock:test', firstToken!);
    expect(await service.acquireLock('lock:test', 60)).toBeTruthy();
  });
});
