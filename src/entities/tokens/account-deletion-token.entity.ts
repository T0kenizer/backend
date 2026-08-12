import { Token } from '@entities/tokens/token.entity';
import { User } from '@entities/user.entity';
import { Entity, Index, ManyToOne } from '@mikro-orm/core';

@Entity({
  tableName: 'account_deletion_tokens',
})
@Index({
  name: 'idx_account_deletion_tokens_token_hash',
  properties: ['tokenHash'],
})
export class AccountDeletionToken extends Token {
  @ManyToOne(() => User, {
    name: 'user_uuid',
    nullable: false,
  })
  user!: User;
}
