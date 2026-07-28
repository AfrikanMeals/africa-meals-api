import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageSettingsService } from '@modules/storage-settings/storage-settings.service';
import { ImageCompressionService } from './image-compression.service';
import { StorageEngineFactory } from './storage-engine.factory';
import { MediasService } from './medias.service';

describe('MediasService', () => {
  let service: MediasService;
  // Env mutable par test : la bascule « Block all public access » se pilote par
  // AWS_S3_PUBLIC_READ / AWS_S3_PUBLIC_BASE_URL.
  let env: Record<string, string | undefined>;

  beforeEach(async () => {
    env = {
      AWS_S3_BUCKET: 'wise-eat',
      AWS_REGION: 'us-east-1',
      GCS_BUCKET: 'wise-eat-com',
      API_PUBLIC_BASE_URL: 'https://api.wise-eat.com',
      MINIO_PUBLIC_BASE_URL: 'https://storage.wise-eat.com/wise-eat',
      MINIO_ENDPOINT: 'https://storage.wise-eat.com',
    };
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
              enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
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
            get: jest.fn((key: string) => env[key]),
          },
        },
      ],
    }).compile();

    service = module.get<MediasService>(MediasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('forces proxy on raw S3 hostnames even if AWS_S3_PUBLIC_READ=true', async () => {
    // Fix: env PUBLIC_READ mal alignée + Block Public Access → 403 sur
    // *.s3.amazonaws.com. Seul un CDN custom (AWS_S3_PUBLIC_BASE_URL) reste direct.
    env.AWS_S3_PUBLIC_READ = 'true';
    const url = 'https://wise-eat.s3.amazonaws.com/stores/abc/profile/x.png';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/stores/abc/profile/x.png',
    );
  });

  it('forces proxy on S3 URLs when public access is blocked', async () => {
    // AWS_S3_PUBLIC_READ absent = « Block all public access » : une URL directe
    // renverrait 403, elle doit repartir par /medias/public/ sans toggle admin.
    const url = 'https://wise-eat.s3.amazonaws.com/stores/abc/profile/x.png';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/stores/abc/profile/x.png',
    );
  });

  it('forces proxy on S3 URLs that carry a client cache-buster query', async () => {
    const url =
      'https://wise-eat.s3.amazonaws.com/stores/6a501e8400ad78d30fcaac89/profile/c49a5c9d-3dc7-4e49-8173-dd1f04b7b78b.webp?_ae=6a501e8400ad78d30fcaac89';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/stores/6a501e8400ad78d30fcaac89/profile/c49a5c9d-3dc7-4e49-8173-dd1f04b7b78b.webp',
    );
  });

  it('keeps direct S3 URLs behind a CDN even when the bucket is private', async () => {
    env.AWS_S3_PUBLIC_BASE_URL = 'https://cdn.wise-eat.com';
    const url = 'https://cdn.wise-eat.com/stores/abc/profile/x.png';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(url);
  });

  it('does not proxy MinIO URLs just because S3 is private (pool mixte)', async () => {
    // Sans MINIO_PUBLIC_BASE_URL : la décision passe par MINIO_PUBLIC_READ, qui
    // reste ouvert. Un S3 privé ne doit pas entraîner les médias MinIO avec lui.
    delete env.MINIO_PUBLIC_BASE_URL;
    const url =
      'https://storage.wise-eat.com/wise-eat/catalog/categories/abc.webp';
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
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
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
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
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
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
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
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
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

  it('rewrites Vercel Blob private URLs to proxy', async () => {
    const url =
      'https://wise-eat.private.blob.vercel-storage.com/stores/abc/profile/x.webp';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/stores/abc/profile/x.webp',
    );
  });

  it('rewrites private R2 endpoint URLs to proxy', async () => {
    // Sans R2_PUBLIC_BASE_URL l’endpoint n’est pas anonyme → proxy obligatoire.
    delete env.R2_PUBLIC_BASE_URL;
    env.R2_BUCKET = 'wise-eat';
    env.R2_ACCOUNT_ID = 'acct';
    const url =
      'https://acct.r2.cloudflarestorage.com/wise-eat/stores/abc/profile/x.webp';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(
      'https://api.wise-eat.com/medias/public/stores/abc/profile/x.webp',
    );
  });

  it('keeps R2 custom domain URLs when R2_PUBLIC_BASE_URL is set', async () => {
    env.R2_PUBLIC_BASE_URL = 'https://media.wise-eat.com';
    const url = 'https://media.wise-eat.com/stores/abc/profile/x.webp';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(url);
  });

  it('keeps Firebase token URLs when media proxy is off and engine is firebase', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'firebase',
      storageEnginePool: ['firebase'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: false,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
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
      'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/stores%2Fabc%2Fx.webp?alt=media&token=tok';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(url);
  });

  it('keeps files.wise-eat.com CDN URLs when media proxy is enabled', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'minio',
      storageEnginePool: ['minio'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: true,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    env.MINIO_PUBLIC_BASE_URL = 'https://files.wise-eat.com';
    const url =
      'https://files.wise-eat.com/stores/abc/products/x.jpg';
    await expect(service.resolvePublicMediaUrl(url)).resolves.toBe(url);
  });

  it('heals nested CDN URL wrongly encoded under medias/public', async () => {
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'minio',
      storageEnginePool: ['minio'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: true,
      enginesEnabled: { firebase: true, gcs: true, s3: true, minio: true, r2: true, vercelBlob: true },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    env.MINIO_PUBLIC_BASE_URL = 'https://files.wise-eat.com';
    const broken =
      'https://apis.wise-eat.com/medias/public/https%3A//files.wise-eat.com/stores/abc/products/x.jpg';
    // L’objet n’existe que sur le CDN files — restaurer l’URL directe (proxy SDK = 500).
    await expect(service.resolvePublicMediaUrl(broken)).resolves.toBe(
      'https://files.wise-eat.com/stores/abc/products/x.jpg',
    );
  });

  // Fix: AccessDenied sur un moteur + NoSuchKey sur un autre → 404 (pas 500).
  it('streamPublicObject returns 404 when any engine confirms not found', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const { Readable } = await import('stream');
    const storageSettings = service['storageSettings'] as StorageSettingsService;
    jest.spyOn(storageSettings, 'getPublicSettings').mockResolvedValue({
      compressionEnabled: false,
      maxFileSizeMb: 5,
      storageEngine: 'gcs',
      storageEnginePool: ['gcs', 'vercelBlob'],
      fallbackStorageEngine: null,
      mediaProxyEnabled: true,
      enginesEnabled: {
        firebase: true,
        gcs: true,
        s3: true,
        minio: true,
        r2: true,
        vercelBlob: true,
      },
      moduleStorageEngines: {
        catalog: 'default',
        profile: 'default',
        marketing: 'default',
        chat: 'default',
        system: 'default',
      },
      updatedAt: null,
    });
    const factory = service['engineFactory'] as StorageEngineFactory & {
      enginesToTryForRead: jest.Mock;
    };
    factory.enginesToTryForRead = jest.fn().mockReturnValue([
      {
        id: 'gcs',
        isConfigured: () => true,
        readObject: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }),
          ),
        upload: jest.fn(),
        delete: jest.fn(),
        deleteFilesWithPrefix: jest.fn(),
        deleteFilesWithPrefixExcept: jest.fn(),
      },
      {
        id: 'vercelBlob',
        isConfigured: () => true,
        readObject: jest
          .fn()
          .mockRejectedValue(
            new Error('No such object: vercel-blob/icons8-trophy.gif'),
          ),
        upload: jest.fn(),
        delete: jest.fn(),
        deleteFilesWithPrefix: jest.fn(),
        deleteFilesWithPrefixExcept: jest.fn(),
      },
    ]);
    jest
      .spyOn(
        service as unknown as {
          tryStreamFromPublicBases: () => Promise<null>;
        },
        'tryStreamFromPublicBases',
      )
      .mockResolvedValue(null);

    await expect(
      service.streamPublicObject('icons8-trophy.gif'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Objet présent sur Vercel Blob malgré AccessDenied GCS → succès.
    factory.enginesToTryForRead = jest.fn().mockReturnValue([
      {
        id: 'gcs',
        isConfigured: () => true,
        readObject: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }),
          ),
        upload: jest.fn(),
        delete: jest.fn(),
        deleteFilesWithPrefix: jest.fn(),
        deleteFilesWithPrefixExcept: jest.fn(),
      },
      {
        id: 'vercelBlob',
        isConfigured: () => true,
        readObject: jest.fn().mockResolvedValue({
          body: Readable.from(Buffer.from('GIF89a')),
          contentType: 'image/gif',
        }),
        upload: jest.fn(),
        delete: jest.fn(),
        deleteFilesWithPrefix: jest.fn(),
        deleteFilesWithPrefixExcept: jest.fn(),
      },
    ]);
    const hit = await service.streamPublicObject('icons8-trophy.gif');
    expect(hit.contentType).toBe('image/gif');
  });
});
