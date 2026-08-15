import { AccountDeletionToken } from '@entities/tokens/account-deletion-token.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as Constants from '@modules/account-deletions/account-deletions.constants';
import { ConfigService } from '@modules/config/config.service';
import { MailService } from '@modules/mail/mail.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AccountDeletionsService {
  private readonly logger = new Logger(AccountDeletionsService.name);

  constructor(
    @InjectRepository(AccountDeletionToken)
    private readonly tokenRepository: EntityRepository<AccountDeletionToken>,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  public async requestDeletion(user: User): Promise<void> {
    const em = this.tokenRepository.getEntityManager();

    await this.tokenRepository.nativeDelete({ user, usedAt: null });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hash(rawToken);
    const expiresAt = new Date(Date.now() + Constants.TOKEN_TTL_MS);

    this.tokenRepository.create({ user, tokenHash, expiresAt });
    await em.flush();

    const deletionUrl = `${this.configService.get('FRONTEND_URL')}/delete-account?token=${rawToken}`;

    try {
      await this.mailService.sendAccountDeletion(user.email, deletionUrl);
    } catch (error) {
      this.logger.error(
        `Failed to send account deletion email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  public async validateToken(
    raw: string,
    user: User,
  ): Promise<{ email: string }> {
    const token = await this.findValidToken(raw, user);

    return { email: token.user.email };
  }

  public async applyDeletion(raw: string, user: User): Promise<void> {
    const token = await this.findValidToken(raw, user);
    const em = this.tokenRepository.getEntityManager();
    const { email } = token.user;

    // Anonymize rather than just flag: it scrubs personal data and frees the
    // unique username/email/google_id columns so the person can sign up again.
    const deletedUser = token.user;
    deletedUser.deletedAt = new Date();
    deletedUser.username = `deleted_${deletedUser.uuid}`;
    deletedUser.email = `deleted_${deletedUser.uuid}@deleted.invalid`;
    deletedUser.googleId = undefined;
    deletedUser.password = undefined;
    deletedUser.displayName = undefined;
    deletedUser.avatarUrl = undefined;
    token.usedAt = new Date();
    await em.flush();

    // The account is already gone, so a failed notice must not fail the request.
    try {
      await this.mailService.sendAccountDeleted(email);
    } catch (error) {
      this.logger.error(
        `Failed to send account deletion notice to ${email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async findValidToken(
    raw: string,
    user: User,
  ): Promise<AccountDeletionToken> {
    const tokenHash = this.hash(raw);

    const token = await this.tokenRepository.findOne(
      { tokenHash, usedAt: null },
      { populate: ['user'] },
    );

    if (!token) throw new NotFoundException('Invalid or expired token');

    if (token.expiresAt < new Date())
      throw new BadRequestException('Token has expired');

    // The token confirms the intent, the session confirms the identity: both
    // must point at the same account before anything is deleted.
    if (token.user.uuid !== user.uuid)
      throw new ForbiddenException('Token does not belong to the current user');

    return token;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
