import './setup-dns-resolver';
import { compressionMiddleware } from './compression-middleware';
import {
  applyHttpServerTimeouts,
  httpRequestTimeoutMiddleware,
} from './http-request-timeout';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { sendNestHttpText } from '@common/http/http-response.util';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';
import { httpRateLimitMiddleware } from './common/rate-limit/http-rate-limit.middleware';
import { RateLimitService } from './common/rate-limit/rate-limit.service';
import { httpDryRunMiddleware } from './common/http/dry-run.middleware';
import { isFastifyHttpAdapter } from './http-adapter.util';
import { registerFastifyBodyParsing } from './register-fastify-body-parsing';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    bodyLimit: 50 * 1024 * 1024,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bodyParser: false, rawBody: true },
  );
  registerFastifyBodyParsing(adapter);
  app.enableShutdownHooks();
  app.use(httpRequestTimeoutMiddleware());
  app.use(httpRateLimitMiddleware(app.get(RateLimitService)));
  app.use(compressionMiddleware({ threshold: 1024 }));
  app.use(httpDryRunMiddleware());
  app.use('/robots.txt', (_req, res) => {
    sendNestHttpText(
      res,
      200,
      'User-agent: *\nDisallow: /\n',
      'text/plain',
    );
  });
  await configureApplication(app);

  const port = Number(process.env.NODE_PORT || process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  applyHttpServerTimeouts(app.getHttpServer());
  const graphqlNote = isFastifyHttpAdapter()
    ? ' — GraphQL désactivé (PR2 : @apollo/server + Fastify 4)'
    : '';
  console.warn(
    `🚀 API (Fastify): http://0.0.0.0:${port}/api (docs: /api/docs, health: /api/health)${graphqlNote}`,
  );
}
bootstrap();
