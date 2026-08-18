import {
  FieldBadRequestException,
  FieldConflictException,
} from '@/exceptions/field.exceptions';
import { User } from '@entities/user.entity';
import { EntityRepository, ref, RequiredEntityData } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { AccountConfirmationsService } from '@modules/account-confirmations/account-confirmations.service';
import { FilesService } from '@modules/files/files.service';
import { MailService } from '@modules/mail/mail.service';
import { BANNED_USERNAMES } from '@modules/users/users.constants';
import * as Types from '@modules/users/users.types';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FileStatus, PartialUpdateUserData } from '@tokenizer/shared/types';
import bcrypt from 'bcrypt';
import slugify from 'slugify';
import { z } from 'zod';

const HASH_ROUNDS = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: EntityRepository<User>,
    private readonly mailService: MailService,
    private readonly accountConfirmationsService: AccountConfirmationsService,
    private readonly filesService: FilesService,
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

  public async findUserByUuid(uuid: string): Promise<Nullable<User>> {
    // Callers may pass an anonymous client id here (not a uuid at all), so
    // this must not reach the Postgres uuid cast with a malformed value.
    if (!z.uuid().safeParse(uuid).success) return null;

    return this.usersRepository.findOne({ uuid }, { populate: ['avatar'] });
  }

  public async findOrCreateFromGoogle(
    data: Types.GoogleProfileData,
  ): Promise<User> {
    const em = this.usersRepository.getEntityManager();

    const byGoogleId = await this.usersRepository.findOne({
      googleId: data.googleId,
    });
    if (byGoogleId) return byGoogleId;

    const byEmail = await this.usersRepository.findOne({ email: data.email });
    if (byEmail) {
      byEmail.googleId = data.googleId;
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
      googleId: data.googleId,
      // Google already vetted the address, so there is nothing left to confirm.
      confirmedAt: new Date(),
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

  public async create(data: RequiredEntityData<User>): Promise<User> {
    if (BANNED_USERNAMES.includes(data.username))
      throw new FieldBadRequestException({
        username: `Username "${data.username}" is not allowed`,
      });

    const existingUser = await Promise.all([
      this.usersRepository.findOne({ username: data.username }),
      this.usersRepository.findOne({ email: data.email }),
    ]);

    if (existingUser[0])
      throw new FieldConflictException({
        username: `Username ${data.username} is already in use`,
      });
    if (existingUser[1])
      throw new FieldConflictException({
        email: `Email ${data.email} is already in use`,
      });

    const hashedPassword = UsersService.hashPassword(data.password as string);

    const em = this.usersRepository.getEntityManager();

    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
    });

    await em.flush();

    await this.accountConfirmationsService.sendConfirmation(user);

    return user;
  }

  public async partialUpdate(
    user: User,
    data: PartialUpdateUserData,
  ): Promise<User> {
    const em = this.usersRepository.getEntityManager();

    if (data.username !== undefined && data.username !== user.username) {
      if (BANNED_USERNAMES.includes(data.username))
        throw new FieldBadRequestException({
          username: `Username "${data.username}" is not allowed`,
        });

      const existing = await this.usersRepository.findOne({
        username: data.username,
      });
      if (existing)
        throw new FieldConflictException({
          username: `Username ${data.username} is already in use`,
        });

      user.username = data.username;
    }

    const previousEmail = user.email;
    const emailChanged =
      data.email !== undefined && data.email !== previousEmail;

    if (emailChanged) {
      const existing = await this.usersRepository.findOne({
        email: data.email,
      });
      if (existing)
        throw new FieldConflictException({
          email: `Email ${data.email} is already in use`,
        });

      user.email = data.email as string;
      // The new address is unproven until its owner clicks the link.
      user.confirmedAt = undefined;
    }

    if (data.displayName !== undefined)
      user.displayName = data.displayName ?? undefined;

    if (data.avatar !== undefined) {
      if (data.avatar === null) {
        user.avatar = undefined;
      } else {
        const file = await this.filesService.findFileByUuid(data.avatar);

        // Owned-only keeps a user from pointing at someone else's upload.
        if (!file || file.createdBy?.uuid !== user.uuid)
          throw new FieldBadRequestException({
            avatar: 'Avatar must reference a file uploaded by the user',
          });

        const status: FileStatus = file.status;
        if (status !== FileStatus.Ready)
          throw new FieldBadRequestException({
            avatar: 'Avatar file content is not ready',
          });

        user.avatar = ref(file);
      }
    }

    await em.flush();

    // Runs last so a rejected username or email leaves the password untouched;
    // it flushes and notifies on its own.
    if (data.password !== undefined)
      await this.updatePassword(user, data.password);

    if (emailChanged) {
      // The change is already persisted, so a failed notice must not fail the
      // request.
      try {
        await this.mailService.sendEmailChanged(previousEmail, user.email);
      } catch (error) {
        this.logger.error(
          `Failed to send email change notice to ${previousEmail}`,
          error instanceof Error ? error.stack : String(error),
        );
      }

      await this.accountConfirmationsService.sendConfirmation(user);
    }

    return user;
  }

  public async updatePassword(user: User, password: string): Promise<void> {
    const entityManager = this.usersRepository.getEntityManager();
    user.password = bcrypt.hashSync(password, HASH_ROUNDS);
    await entityManager.flush();

    // The password is already changed, so a failed notice must not fail the
    // request.
    try {
      await this.mailService.sendPasswordChanged(user.email);
    } catch (error) {
      this.logger.error(
        `Failed to send password change notice to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private static hashPassword(password: string): string {
    return bcrypt.hashSync(password, HASH_ROUNDS);
  }

  private static comparePassword(password: string, hash: string): boolean {
    return bcrypt.compareSync(password, hash);
  }
}
