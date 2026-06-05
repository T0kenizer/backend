import { PasswordResetToken } from '@entities/password-reset-token.entity';
import { User } from '@entities/user.entity';
import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { ConfigService } from '@modules/config/config.service';
import { MailService } from '@modules/mail/mail.service';
import { UsersService } from '@modules/users/users.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetsService {
  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly tokenRepository: EntityRepository<PasswordResetToken>,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  public async requestReset(email: string): Promise<void> {
    const user = await this.userRepository.findOne({ email });

    if (!user || !user.password) return;
    const em = this.tokenRepository.getEntityManager();

    // clear old users token
    await this.tokenRepository.nativeDelete({ user, usedAt: null });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hash(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    this.tokenRepository.create({ user, tokenHash, expiresAt });
    await em.flush();

    const resetUrl = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordReset(email, resetUrl);
  }

  public async validateToken(raw: string): Promise<void> {
    await this.findValidToken(raw);
  }

  public async applyReset(raw: string, password: string): Promise<void> {
    const token = await this.findValidToken(raw);
    const em = this.tokenRepository.getEntityManager();

    if (!token) return;
    await this.usersService.updatePassword(token.user, password);
    token.usedAt = new Date();
    await em.flush();
  }

  private async findValidToken(
    raw: string,
  ): Promise<PasswordResetToken | null> {
    const tokenHash = this.hash(raw);

    const token = await this.tokenRepository.findOne(
      { tokenHash, usedAt: null },
      { populate: ['user'] },
    );

    if (token && token.expiresAt < new Date()) {
      throw new BadRequestException('Token has expired');
    }

    return token;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
