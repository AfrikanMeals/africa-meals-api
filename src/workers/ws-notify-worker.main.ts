import { NestFactory } from '@nestjs/core';
import { WsNotifyWorkerModule } from './ws-notify-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WsNotifyWorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
