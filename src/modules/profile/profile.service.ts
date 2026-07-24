import { User } from '@entities/user.entity';
import { ConfigService } from '@modules/config/config.service';
import { MailService } from '@modules/mail/mail.service';
import { RedisService } from '@modules/redis/redis.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ChangePasswordData, UpdateProfileData } from './profile.dtos';

const TOKEN_TTL_S = 3600; // 1 hour
const REDIS_PREFIX = 'account-deletion:';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  public async update(user: User, data: UpdateProfileData): Promise<User> {
    return this.usersService.updateProfile(user, data);
  }

  public async changePassword(
    user: User,
    data: ChangePasswordData,
  ): Promise<void> {
    if (user.password) {
      if (!data.currentPassword)
        throw new BadRequestException('Current password is required');
      const valid = await this.usersService.validateUser(
        user.username,
        data.currentPassword,
      );
      if (!valid) throw new UnauthorizedException('Invalid current password');
    } else if (data.currentPassword) {
      throw new BadRequestException('This account has no password yet');
    }

    await this.usersService.updatePassword(user, data.newPassword);
  }

  public async unlinkGoogle(user: User): Promise<User> {
    if (!user.password)
      throw new BadRequestException('Set a password before unlinking Google');
    if (!user.googleId)
      throw new BadRequestException('No Google account linked');

    return this.usersService.unlinkGoogle(user);
  }

  public async requestDeletion(user: User): Promise<void> {
    const FRONTEND_URL = this.configService.get('FRONTEND_URL');
    const rawToken = await this.redisService.setToken(
      REDIS_PREFIX,
      user.uuid,
      TOKEN_TTL_S,
    );

    const deleteUrl = `${FRONTEND_URL}/delete-account?token=${rawToken}`;

    try {
      await this.mailService.sendAccountDeletion(user.email, deleteUrl);
    } catch (error) {
      this.logger.error(
        `Failed to send account deletion email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  public async confirmDeletion(rawToken: string): Promise<User> {
    const userUuid = await this.redisService.getToken(REDIS_PREFIX, rawToken);
    return this.usersService.softDelete(userUuid);
  }
}
