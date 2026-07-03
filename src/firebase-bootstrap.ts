import './setup-dns-resolver';
import { compressionMiddleware } from './compression-middleware';
import { DEFAULT_URLENCODED_BODY_LIMIT } from '@common/http/body-parser-limits.util';
import { createRouteAwareJsonBodyParser } from './route-aware-body-parser';
import { httpRequestTimeoutMiddleware } from './http-request-timeout';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';
import { httpDryRunMiddleware } from './common/http/dry-run.middleware';

let cachedServer: express.Express | undefined;

/**
 * Instance Express unique (réutilisée entre invocations Cloud Functions — warm start).
 * `preserveRawBody: true` requis pour vérifier la signature Stripe (`Stripe-Signature`).
 */
export async function getExpressServer(): Promise<express.Express> {
  if (cachedServer) {
    return cachedServer;
  }
  const expressApp = express();
  expressApp.use(httpRequestTimeoutMiddleware());
  expressApp.use(compressionMiddleware({ threshold: 1024 }));
  expressApp.use(createRouteAwareJsonBodyParser({ preserveRawBody: true }));
  expressApp.use(httpDryRunMiddleware());
  expressApp.use(
    express.urlencoded({
      extended: true,
      limit: DEFAULT_URLENCODED_BODY_LIMIT,
    }),
  );
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
