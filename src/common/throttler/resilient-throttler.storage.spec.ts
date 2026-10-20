import { ThrottlerStorageService } from '@nestjs/throttler';
import { ResilientThrottlerStorage } from './resilient-throttler.storage';

const record = (totalHits: number) => ({
  totalHits,
  timeToExpire: 60,
  isBlocked: false,
  timeToBlockExpire: 0,
});

function make() {
  let clock = 1_000_000;
  const redis = { increment: jest.fn() };
  const memory = new ThrottlerStorageService();
  const storage = new ResilientThrottlerStorage(redis, memory, () => clock);
  const hit = () => storage.increment('ip:1.2.3.4', 60000, 100, 0, 'default');
  return {
    redis,
    memory,
    hit,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('ResilientThrottlerStorage (INF-11)', () => {
  afterEach(() => jest.useRealTimers());

  it('counts in Redis while it answers', async () => {
    const { redis, hit } = make();
    redis.increment.mockResolvedValue(record(7));
    await expect(hit()).resolves.toEqual(record(7));
    expect(redis.increment).toHaveBeenCalledWith(
      'ip:1.2.3.4',
      60000,
      100,
      0,
      'default',
    );
  });

  it('falls back to memory when Redis fails, instead of failing the request', async () => {
    const { redis, memory, hit } = make();
    const inMemory = jest.spyOn(memory, 'increment');
    redis.increment.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await hit();

    expect(result.totalHits).toBe(1);
    expect(inMemory).toHaveBeenCalledTimes(1);
    memory.onApplicationShutdown();
  });

  it('leaves Redis alone for 30 seconds after a failure, then tries again', async () => {
    const { redis, memory, hit, advance } = make();
    redis.increment.mockRejectedValueOnce(new Error('down'));
    await hit();
    await hit();
    expect(redis.increment).toHaveBeenCalledTimes(1);

    advance(30_000);
    redis.increment.mockResolvedValue(record(3));
    await expect(hit()).resolves.toEqual(record(3));
    expect(redis.increment).toHaveBeenCalledTimes(2);
    memory.onApplicationShutdown();
  });
});
