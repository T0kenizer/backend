import { AccountConfirmationToken } from '@entities/tokens/account-confirmation-token.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as Constants from '@modules/account-confirmations/account-confirmations.constants';
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
export class AccountConfirmationsService {
  private readonly logger = new Logger(AccountConfirmationsService.name);

  constructor(
    @InjectRepository(AccountConfirmationToken)
    private readonly tokenRepository: EntityRepository<AccountConfirmationToken>,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /** Issues a token and mails it, for a user that is already persisted. */
  public async sendConfirmation(user: User): Promise<void> {
    const em = this.tokenRepository.getEntityManager();

    await this.tokenRepository.nativeDelete({ user, usedAt: null });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hash(rawToken);
    const expiresAt = new Date(Date.now() + Constants.TOKEN_TTL_MS);

    this.tokenRepository.create({ user, tokenHash, expiresAt });
    await em.flush();

    const confirmationUrl = `${this.configService.get('FRONTEND_URL')}/confirm-account?token=${rawToken}`;

    try {
      await this.mailService.sendAccountConfirmation(
        user.email,
        confirmationUrl,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send account confirmation email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  public async requestConfirmation(email: string): Promise<void> {
    const user = await this.userRepository.findOne({ email });

    // Stay silent on unknown or already confirmed accounts so this endpoint
    // cannot be used to probe which emails are registered.
    if (!user || user.confirmedAt) return;

    await this.sendConfirmation(user);
  }

  public async validateToken(
    raw: string,
    currentUser?: User,
  ): Promise<{ email: string }> {
    const token = await this.findValidToken(raw, currentUser);

    return { email: token.user.email };
  }

  public async applyConfirmation(
    raw: string,
    currentUser?: User,
  ): Promise<void> {
    const token = await this.findValidToken(raw, currentUser);
    const em = this.tokenRepository.getEntityManager();
    const { email } = token.user;

    token.user.confirmedAt = new Date();
    token.usedAt = new Date();
    await em.flush();

    // The account is already confirmed, so a failed notice must not fail the
    // request.
    try {
      await this.mailService.sendAccountConfirmed(email);
    } catch (error) {
      this.logger.error(
        `Failed to send account confirmation notice to ${email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async findValidToken(
    raw: string,
    currentUser?: User,
  ): Promise<AccountConfirmationToken> {
    const tokenHash = this.hash(raw);

    const token = await this.tokenRepository.findOne(
      { tokenHash, usedAt: null },
      { populate: ['user'] },
    );

    if (!token) throw new NotFoundException('Invalid or expired token');

    if (token.expiresAt < new Date())
      throw new BadRequestException('Token has expired');

    // Confirmation also happens right after signup, before any session exists,
    // so the endpoint stays public; but when someone IS logged in, the token
    // must be theirs.
    if (currentUser && token.user.uuid !== currentUser.uuid)
      throw new ForbiddenException('Token does not belong to the current user');

    return token;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
