import { CreateSuperUserCommand } from '@commands/create-superuser.command';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [UsersModule],
  providers: [CreateSuperUserCommand],
})
export class CommandsModule {}
