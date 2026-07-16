import { User } from '@entities/user.entity';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ChangePasswordData, UpdateProfileData } from './profile.dtos';

@Injectable()
export class ProfileService {
  constructor(private readonly usersService: UsersService) {}

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
}
