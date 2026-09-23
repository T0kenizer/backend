import { input, password, select } from '@inquirer/prompts';
import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import { UsersService } from '@modules/users/users.service';
import { createUserDataSchema } from '@tokenizer/shared/schemas';
import { Plan, UserRole } from '@tokenizer/shared/types';
import { Command, CommandRunner, Option } from 'nest-commander';

interface CreateSuperUserOptions {
  role?: UserRole;
}

const validateEmail = (value: string) => {
  const result = createUserDataSchema
    .pick({ email: true })
    .safeParse({ email: value });
  return result.success || result.error.issues[0]?.message || 'Invalid email';
};

const validateUsername = (value: string) => {
  const result = createUserDataSchema
    .pick({ username: true })
    .safeParse({ username: value });
  return (
    result.success || result.error.issues[0]?.message || 'Invalid username'
  );
};

const validatePassword = (value: string) => {
  const result = createUserDataSchema
    .pick({ password: true })
    .safeParse({ password: value });
  return (
    result.success || result.error.issues[0]?.message || 'Invalid password'
  );
};

const SELECTABLE_PLANS = Object.values(Plan).filter(
  (plan): plan is Exclude<Plan, Plan.Anonymous> => plan !== Plan.Anonymous,
);

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
    try {
      const email = await input({
        message: 'Email:',
        validate: validateEmail,
      });

      const username = await input({
        message: 'Username:',
        validate: validateUsername,
      });

      const passwordValue = await password({
        message: 'Password:',
        mask: true,
        validate: validatePassword,
      });

      await password({
        message: 'Password (again):',
        mask: true,
        validate: (value) =>
          value === passwordValue || 'Passwords do not match',
      });

      const plan = await select({
        message: 'Plan:',
        choices: SELECTABLE_PLANS.map((value) => ({ name: value, value })),
        default: Plan.Premium,
      });

      await this.usersService.create({
        email,
        username,
        password: passwordValue,
        role: options.role ?? UserRole.Admin,
        plan,
        confirmedAt: new Date(),
      });

      console.log(`Superuser "${username}" created successfully!`);
    } catch (error) {
      // Ctrl+C in a prompt is a deliberate abort, not a failure.
      if (error instanceof Error && error.name === 'ExitPromptError') return;

      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to create superuser: ${message}`);
      process.exitCode = 1;
    }
  }
}
