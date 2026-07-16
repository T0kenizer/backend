import { User } from '@entities/user.entity';
import { EntityRepository, RequiredEntityData } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { BANNED_USERNAMES } from '@modules/users/users.constants';
import * as Types from '@modules/users/users.types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import slugify from 'slugify';

const HASH_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: EntityRepository<User>,
  ) {}

  public async validateUser(
    login: string,
    password: string,
  ): Promise<Nullable<User>> {
    const user = await this.usersRepository.findOne({
      $or: [{ username: login }, { email: login }],
    });

    if (
      !user?.password ||
      !UsersService.comparePassword(password, user.password)
    )
      return null;

    return user;
  }

  public async getUserByUuid(uuid: string): Promise<User> {
    const user = await this.usersRepository.findOne({ uuid });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  public async findOrCreateFromGoogle(
    data: Types.GoogleProfileData,
  ): Promise<User> {
    const em = this.usersRepository.getEntityManager();

    const byGoogleId = await this.usersRepository.findOne({
      googleId: data.googleId,
    });
    if (byGoogleId) {
      let dirty = false;
      if (data.avatarUrl && byGoogleId.avatarUrl !== data.avatarUrl) {
        byGoogleId.avatarUrl = data.avatarUrl;
        dirty = true;
      }
      if (dirty) await em.flush();
      return byGoogleId;
    }

    const byEmail = await this.usersRepository.findOne({ email: data.email });
    if (byEmail) {
      byEmail.googleId = data.googleId;
      if (data.avatarUrl) byEmail.avatarUrl = data.avatarUrl;
      if (!byEmail.displayName && data.displayName)
        byEmail.displayName = data.displayName;
      await em.flush();
      return byEmail;
    }

    const username = await this.generateUniqueUsername(
      data.displayName ?? data.email.split('@')[0],
    );

    const user = this.usersRepository.create({
      username,
      email: data.email,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
      googleId: data.googleId,
    });

    await em.flush();
    return user;
  }

  private async generateUniqueUsername(seed: string): Promise<string> {
    const base =
      slugify(seed, { lower: true, strict: true, replacement: '_' }).slice(
        0,
        50,
      ) || 'user';

    let candidate = base;
    let suffix = 1;
    while (
      BANNED_USERNAMES.includes(candidate) ||
      (await this.usersRepository.findOne({ username: candidate }))
    ) {
      suffix += 1;
      candidate = `${base}_${suffix}`;
    }
    return candidate;
  }

  private validateUsername(username: string): void {
    if (BANNED_USERNAMES.includes(username))
      throw new BadRequestException(`Username "${username}" is not allowed`);
  }

  public async create(data: RequiredEntityData<User>): Promise<User> {
    this.validateUsername(data.username);

    const existingUser = await Promise.all([
      this.usersRepository.findOne({ username: data.username }),
      this.usersRepository.findOne({ email: data.email }),
    ]);

    if (existingUser[0])
      throw new ConflictException(
        `Username ${data.username} is already in use`,
      );
    if (existingUser[1])
      throw new ConflictException(`Email ${data.email} is already in use`);

    const hashedPassword = UsersService.hashPassword(data.password as string);

    const em = this.usersRepository.getEntityManager();

    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
    });

    await em.flush();

    return user;
  }

  public async updateProfile(
    user: User,
    data: { username?: string; displayName?: string | null },
  ): Promise<User> {
    const em = this.usersRepository.getEntityManager();

    if (data.username && data.username !== user.username) {
      this.validateUsername(data.username);
      const existing = await this.usersRepository.findOne({
        username: data.username,
      });
      if (existing) throw new ConflictException('Username is already in use');
      user.username = data.username;
    }

    if (data.displayName !== undefined) {
      user.displayName = data.displayName ?? undefined;
    }

    await em.flush();
    return user;
  }

  public async updatePassword(user: User, password: string): Promise<void> {
    const entityManager = this.usersRepository.getEntityManager();
    user.password = bcrypt.hashSync(password, HASH_ROUNDS);
    await entityManager.flush();
  }

  public async unlinkGoogle(user: User): Promise<User> {
    const em = this.usersRepository.getEntityManager();
    user.googleId = undefined;
    await em.flush();
    return user;
  }

  private static hashPassword(password: string): string {
    return bcrypt.hashSync(password, HASH_ROUNDS);
  }

  private static comparePassword(password: string, hash: string): boolean {
    return bcrypt.compareSync(password, hash);
  }
}
