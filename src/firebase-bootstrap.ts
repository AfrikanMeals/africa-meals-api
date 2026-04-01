import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';

let cachedServer: express.Express | undefined;

/**
 * Instance Express unique (réutilisée entre invocations Cloud Functions — warm start).
 */
export async function getExpressServer(): Promise<express.Express> {
  if (cachedServer) {
    return cachedServer;
  }
  const expressApp = express();
  expressApp.use(express.json({ limit: '60mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '60mb' }));
  const adapter = new ExpressAdapter(expressApp);
  const nestApp = await NestFactory.create(AppModule, adapter, {
    bodyParser: false,
    logger: ['error', 'warn', 'log'],
  });
  await configureApplication(nestApp, { globalPrefix: '' });
  await nestApp.init();
  cachedServer = expressApp;
  return expressApp;
}
