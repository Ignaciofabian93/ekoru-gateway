import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** How long to keep using memory after Redis fails, before trying it again. */
const RETRY_AFTER_MS = 30_000;

/**
 * Rate-limit counters shared through Redis (INF-11), so a deploy or restart
 * no longer resets every visitor's count.
 *
 * Redis is a convenience here, never a dependency: when it does not answer
 * fast, the count falls back to this process's memory (the behaviour before
 * INF-11) and Redis is tried again after half a minute. A Redis outage must
 * not turn every request into a 500.
 */
export class ResilientThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(ResilientThrottlerStorage.name);
  private downUntil = 0;

  constructor(
    private readonly redis: ThrottlerStorage & { onModuleDestroy?(): void },
    private readonly memory = new ThrottlerStorageService(),
    private readonly now: () => number = Date.now,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    if (this.now() >= this.downUntil) {
      try {
        return await this.redis.increment(
          key,
          ttl,
          limit,
          blockDuration,
          throttlerName,
        );
      } catch (error) {
        if (this.downUntil === 0 || this.now() >= this.downUntil) {
          this.logger.warn(
            `Redis rate-limit storage unavailable, counting in memory for ${RETRY_AFTER_MS / 1000}s: ${String(error)}`,
          );
        }
        this.downUntil = this.now() + RETRY_AFTER_MS;
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  onModuleDestroy(): void {
    this.redis.onModuleDestroy?.();
    this.memory.onApplicationShutdown();
  }
}

/**
 * The storage for this environment: Redis when `THROTTLER_REDIS_HOST` is set,
 * otherwise memory only (local development).
 */
export function createThrottlerStorage(env: {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}): ThrottlerStorage | undefined {
  if (!env.host) return undefined;
  const client = new Redis({
    host: env.host,
    port: env.port ?? 6379,
    password: env.password || undefined,
    db: env.db ?? 1,
    keyPrefix: 'gateway:throttle:',
    // Fail fast instead of queueing requests while Redis is away.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 500,
    lazyConnect: false,
  });
  client.on('error', () => {
    // Reported once per outage by ResilientThrottlerStorage; ioredis keeps reconnecting.
  });
  return new ResilientThrottlerStorage(
    new ThrottlerStorageRedisService(client),
  );
}
