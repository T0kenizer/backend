import { input, password } from '@inquirer/prompts';
import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import { UsersService } from '@modules/users/users.service';
import { createUserDataSchema } from '@tokenizer/shared/schemas';
import { UserRole } from '@tokenizer/shared/types';
import { Command, CommandRunner, Option } from 'nest-commander';

interface CreateSuperUserOptions {
  role?: UserRole;
}

@Command({
  name: 'create-superuser',
  description: 'Create a superuser account',
})
export class CreateSuperUserCommand extends CommandRunner {
  constructor(
    private readonly orm: MikroORM,
    private readonly usersService: UsersService,
  ) {
    super();
  }

  @Option({
    flags: '-r, --role <role>',
    description: `User role (${Object.values(UserRole).join(', ')}). Defaults to ${UserRole.Admin}.`,
  })
  parseRole(value: string): UserRole {
    const roles = Object.values(UserRole) as string[];
    if (!roles.includes(value))
      throw new Error(`Invalid role "${value}". Allowed: ${roles.join(', ')}.`);
    return value as UserRole;
  }

  @CreateRequestContext()
  async run(
    _passedParams: string[],
    options: CreateSuperUserOptions = {},
  ): Promise<void> {
    const email = await input({
      message: 'Email:',
      validate: (value) =>
        createUserDataSchema.pick({ email: true }).safeParse({ email: value })
          .success || 'Invalid email',
    });

    const username = await input({
      message: 'Username:',
      validate: (value) =>
        createUserDataSchema
          .pick({ username: true })
          .safeParse({ username: value }).success || 'Invalid username',
    });

    const passwordValue = await password({
      message: 'Password:',
      mask: true,
      validate: (value) =>
        createUserDataSchema
          .pick({ password: true })
          .safeParse({ password: value }).success || 'Invalid password',
    });

    const passwordConfirm = await password({
      message: 'Password (again):',
      mask: true,
      validate: (value) => value === passwordValue || 'Passwords do not match',
    });

    await this.usersService.create({
      email,
      username,
      password: passwordConfirm,
      role: options.role ?? UserRole.Admin,
    });

    console.log(`Superuser "${username}" created successfully!`);
  }
}
