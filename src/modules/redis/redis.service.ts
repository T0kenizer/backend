import { ConfigService } from '@modules/config/config.service';
import * as Types from '@modules/redis/redis.types';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public readonly client: Types.RedisClient;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    this.client = createClient({
      url: `redis://${this.configService.get('REDIS_HOST')}:${this.configService.get('REDIS_PORT')}`,
    });

    this.client.on('connect', () => this.logger.log('Connected to Redis'));
    this.client.on('error', (err) => this.logger.error(err));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async setToken(
    prefix: string,
    value: string,
    expiration: number = 3600,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hash(rawToken);
    const key = `${prefix}${tokenHash}`;

    await this.client.set(key, value, { EX: expiration });
    return rawToken;
  }

  async getToken(prefix: string, rawToken: string): Promise<string> {
    const tokenHash = this.hash(rawToken);
    const key = `${prefix}${tokenHash}`;
    const value = await this.client.getDel(key);

    if (!value) throw new NotFoundException('Invalid or expired token');
    return value;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  getConnectionOptions(): { host: string; port: number } {
    return {
      host: this.configService.get('REDIS_HOST'),
      port: this.configService.get('REDIS_PORT'),
    };
  }
}
