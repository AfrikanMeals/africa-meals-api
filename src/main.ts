import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.use(express.json({ limit: '60mb' }));
  app.use(express.urlencoded({ extended: true, limit: '60mb' }));
  await configureApplication(app);

  const port = Number(process.env.NODE_PORT || process.env.PORT || 3000);
  await app.listen(port);
  console.warn(
    `🚀 API: http://localhost:/api (docs: /api/docs)`,
  );
}
bootstrap();
