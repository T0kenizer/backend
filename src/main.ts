import { setupApp } from '@/setup';
import { setupSwagger } from '@/swagger';
import { AppModule } from '@modules/app.module';
import { NestFactory } from '@nestjs/core';

const DEFAULT_PORT = 3000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  setupApp(app);
  setupSwagger(app);

  const port = process.env.PORT ?? DEFAULT_PORT;
  await app.listen(port);
}

void bootstrap();
