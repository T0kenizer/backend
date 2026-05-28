import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { name, version } from 'package.json';

export function setupSwagger(app: INestApplication): void {
  if (process.env.NODE_ENV !== 'development') return;

  const options = new DocumentBuilder()
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    .setTitle(name as string)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    .setVersion(version as string)

    .addServer('http://localhost:3000', 'Development')

    .build();

  const documentFactory = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, documentFactory);
}
