import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection } from 'mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const mockMongoConnection = {
  readyState: 1,
  name: 'default',
  db: {
    admin: () => ({
      command: jest.fn().mockResolvedValue({ ok: 1 }),
    }),
  },
} as unknown as Connection;

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: getConnectionToken(), useValue: mockMongoConnection },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
