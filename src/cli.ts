import { AppModule } from '@/modules/app.module';
import { CommandFactory } from 'nest-commander';

async function bootstrap() {
  await CommandFactory.run(AppModule, {
    logger: ['error', 'debug', 'verbose'],
  });
}

void bootstrap();
