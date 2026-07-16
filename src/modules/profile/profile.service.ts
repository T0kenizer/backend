import { User } from '@entities/user.entity';
import { UsersService } from '@modules/users/users.service';
import { Injectable } from '@nestjs/common';
import { UpdateProfileData } from './profile.dtos';

@Injectable()
export class ProfileService {
  constructor(private readonly usersService: UsersService) {}

  public async update(user: User, data: UpdateProfileData): Promise<User> {
    return this.usersService.updateProfile(user, data);
  }
}
