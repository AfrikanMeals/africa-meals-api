import './setup-dns-resolver';
import { compressionMiddleware } from './compression-middleware';
import { DEFAULT_URLENCODED_BODY_LIMIT } from '@common/http/body-parser-limits.util';
import { createRouteAwareJsonBodyParser } from './route-aware-body-parser';
import {
  applyHttpServerTimeouts,
  httpRequestTimeoutMiddleware,
} from './http-request-timeout';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';
import { httpRateLimitMiddleware } from './common/rate-limit/http-rate-limit.middleware';
import { RateLimitService } from './common/rate-limit/rate-limit.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.enableShutdownHooks();
  app.use(httpRequestTimeoutMiddleware());
  app.use(httpRateLimitMiddleware(app.get(RateLimitService)));
  app.use(compressionMiddleware({ threshold: 1024 }));
  app.use(createRouteAwareJsonBodyParser({ preserveRawBody: true }));
  app.use(
    express.urlencoded({
      extended: true,
      limit: DEFAULT_URLENCODED_BODY_LIMIT,
    }),
  );
  app.use('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });
  await configureApplication(app);

  const port = Number(process.env.NODE_PORT || process.env.PORT || 3000);
  await app.listen(port);
  applyHttpServerTimeouts(app.getHttpServer());
  console.warn(`🚀 API: http://localhost:${port}/api (docs: /api/docs)`);
}
bootstrap();
