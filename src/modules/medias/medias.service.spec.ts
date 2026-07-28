import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageSettingsService } from '@modules/storage-settings/storage-settings.service';
import { ImageCompressionService } from './image-compression.service';
import { StorageEngineFactory } from './storage-engine.factory';
import { MediasService } from './medias.service';

describe('MediasService', () => {
  let service: MediasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediasService,
        {
          provide: StorageSettingsService,
          useValue: {
            getPublicSettings: jest.fn().mockResolvedValue({
              compressionEnabled: false,
              maxFileSizeMb: 5,
              storageEngine: 's3',
              storageEnginePool: ['s3'],
              fallbackStorageEngine: null,
              mediaProxyEnabled: false,
              enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true },
            }),
            getMaxFileSizeBytes: jest.fn().mockResolvedValue(5 * 1024 * 1024),
          },
        },
        {
          provide: ImageCompressionService,
          useValue: { compressIfImage: jest.fn((f) => Promise.resolve(f)) },
        },
        {
          provide: StorageEngineFactory,
          useValue: {
            resolve: jest.fn(),
            resolveForDelete: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AWS_S3_BUCKET') return 'wise-eat';
              if (key === 'AWS_REGION') return 'us-east-1';
              if (key === 'GCS_BUCKET') return 'wise-eat-com';
              if (key === 'API_PUBLIC_BASE_URL') return 'https://api.wise-eat.com';
              if (key === 'MINIO_PUBLIC_BASE_URL') {
                return 'https://storage.wise-eat.com/wise-eat';
              }
              if (key === 'MINIO_ENDPOINT') return 'https://storage.wise-eat.com';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MediasService>(MediasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('keeps direct S3 URLs when proxy disabled', async () => {
    const url =
      'https://wise-eat.s3.amazonaws.com/stores/abc/profile/x.png';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(url);
  });

  it('rewrites S3 URLs to proxy when enabled', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 's3',
      storageEnginePool: ['s3'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: true,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    const url =
      'https://wise-eat.s3.amazonaws.com/stores/abc/profile/x.png';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/stores/abc/profile/x.png',
    );
  });

  it('keeps direct MinIO URLs when proxy disabled', async () => {
    const url =
      'https://storage.wise-eat.com/wise-eat/catalog/categories/abc.webp';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(url);
  });

  it('rewrites legacy proxy URLs to direct MinIO when proxy disabled', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'minio',
      storageEnginePool: ['minio'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: false,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    const url =
      'https://api.wise-eat.com/medias/public/catalog/categories/abc.webp';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://storage.wise-eat.com/wise-eat/catalog/categories/abc.webp',
    );
  });

  it('rewrites GCS URLs to proxy even when proxy disabled (PAP)', async () => {
    const url =
      'https://storage.googleapis.com/wise-eat-store/catalog/meal.jpg';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/catalog/meal.jpg',
    );
  });

  it('rewrites legacy Firebase URLs to proxy when engine is gcs (never direct GCS)', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'gcs',
      storageEnginePool: ['gcs'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: false,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    const url =
      'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/platform-theme%2Flogo.png?alt=media&token=abc';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/platform-theme/logo.png',
    );
  });

  it('rewrites legacy Firebase URLs to proxy when enabled', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'gcs',
      storageEnginePool: ['gcs'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: true,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    const url =
      'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/catalog%2Fmeal.jpg?alt=media';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/catalog/meal.jpg',
    );
  });
});
