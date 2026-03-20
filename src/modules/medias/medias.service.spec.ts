import { Test, TestingModule } from '@nestjs/testing';
import { MediasService } from './medias.service';

describe('MediasService', () => {
  let service: MediasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediasService,
        { provide: 'FIREBASE_ADMIN', useValue: {} },
        { provide: 'FIREBASE_STORAGE_BUCKET', useValue: 'test-bucket' },
      ],
    }).compile();

    service = module.get<MediasService>(MediasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
