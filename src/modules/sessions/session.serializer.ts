import { User } from '@entities/user.entity';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private readonly em: EntityManager) {
    super();
  }

  serializeUser(user: User, done: (err: unknown, uuid?: string) => void): void {
    done(null, user.uuid);
  }

  async deserializeUser(
    uuid: string,
    done: (err: unknown, user: User | false) => void,
  ): Promise<void> {
    const user = await this.em.fork().findOne(User, { uuid });
    done(null, user ?? false);
  }
}
