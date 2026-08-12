import { createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

/** A {@link RedisClient} wrapped in BullMQ's node-redis adapter. */
export type BullRedisClient = ReturnType<typeof createNodeRedisClient>;

export type RedisConnectionOptions = { host: string; port: number };
