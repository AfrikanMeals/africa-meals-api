import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  console.warn('🚀 ~ App running on port :', process.env.NODE_PORT);
  await app.listen(process.env.NODE_PORT || process.env.PORT || 3000);
}
bootstrap();
