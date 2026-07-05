import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';

describe('App (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    app.enableShutdownHooks();
    await configureApplication(app, { globalPrefix: 'api' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health returns 200 with status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/^(ok|degraded|down)$/),
      }),
    );
  });

  it('GET /api/ returns Hello World', () => {
    return request(app.getHttpServer())
      .get('/api/')
      .expect(200)
      .expect('Hello World!');
  });
});
