import { Token } from '@entities/tokens/token.entity';
import { User } from '@entities/user.entity';
import { Entity, Index, ManyToOne } from '@mikro-orm/core';

@Entity({
  tableName: 'password_reset_tokens',
})
@Index({
  name: 'idx_password_reset_tokens_token_hash',
  properties: ['tokenHash'],
})
export class PasswordResetToken extends Token {
  @ManyToOne(() => User, {
    name: 'user_uuid',
    nullable: false,
  })
  user!: User;
}
