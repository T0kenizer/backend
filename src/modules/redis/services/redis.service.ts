import { ConfigService } from '@modules/config/config.service';
import * as Types from '@modules/redis/redis.types';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

/** Thrown by node-redis when `connect()` is called on an open socket. */
const SOCKET_ALREADY_OPEN = 'Socket already opened';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public readonly client: Types.RedisClient;
  protected readonly logger = new Logger(this.constructor.name);
  private bullClient?: Types.BullRedisClient;

  constructor(protected readonly configService: ConfigService) {
    // Created eagerly (not in onModuleInit) so consumers wired up during module
    // instantiation - e.g. BullModule.forRootAsync - receive a real client.
    this.client = this.createClient();
  }

  /**
   * The client wrapped in BullMQ's node-redis adapter.
   *
   * BullMQ must never receive the raw `redis` client: a worker's blocking
   * connection is built by duplicating `connection`, and that duplication only
   * detects the driver when the client already implements `IRedisClient`. A raw
   * client passes `isRedisInstance` but fails `isIRedisClient`, so BullMQ
   * defaults to wrapping it in the _ioredis_ adapter and then tries to
   * `require('ioredis')` - a package we do not (and need not) install.
   */
  public get bullConnection(): Types.BullRedisClient {
    // Memoised so every queue and worker shares one adapter, and so the
    // adapter's own connect bookkeeping is not duplicated per call.
    this.bullClient ??= createNodeRedisClient(this.client);

    return this.bullClient;
  }

  public get connectionOptions(): Types.RedisConnectionOptions {
    return {
      host: this.configService.get('REDIS_HOST'),
      port: this.configService.get('REDIS_PORT'),
    };
  }

  protected createClient(): Types.RedisClient {
    const { host, port } = this.connectionOptions;

    return createClient({ url: `redis://${host}:${port}` });
  }

  async onModuleInit(): Promise<void> {
    this.client.on('connect', () => this.logger.log('Connected to Redis'));
    this.client.on('error', (err) => this.logger.error(err));

    // `isOpen` is not a safe guard on its own: BullMQ's adapter calls
    // `connect()` as soon as it wraps the client, and `isOpen` only flips once
    // that in-flight promise settles. Checking it here races the adapter and
    // intermittently threw "Socket already opened". Swallow that specific
    // rejection instead, so whichever caller loses the race is a no-op.
    if (!this.client.isOpen) {
      try {
        await this.client.connect();
      } catch (error) {
        if (
          !(error instanceof Error && error.message === SOCKET_ALREADY_OPEN)
        ) {
          throw error;
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }
}
