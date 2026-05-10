import { compressionMiddleware } from './compression-middleware';
import { httpRequestTimeoutMiddleware } from './http-request-timeout';
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
  expressApp.use(httpRequestTimeoutMiddleware());
  expressApp.use(compressionMiddleware({ threshold: 1024 }));
  expressApp.use(express.json({ limit: '60mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '60mb' }));
  const adapter = new ExpressAdapter(expressApp);
  const nestApp = await NestFactory.create(AppModule, adapter, {
    bodyParser: false,
    logger: ['error', 'warn', 'log'],
  });
  nestApp.enableShutdownHooks();
  await configureApplication(nestApp, { globalPrefix: '' });
  await nestApp.init();
  cachedServer = expressApp;
  return expressApp;
}
