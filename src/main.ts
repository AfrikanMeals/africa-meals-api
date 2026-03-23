import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await configureApplication(app);

  const port = Number(process.env.NODE_PORT || process.env.PORT || 3000);
  await app.listen(port);
  console.warn(
    `🚀 API: http://localhost:${port}/api (ex: /api/auth/verify, /api/auth/login)`,
  );
}
bootstrap();
