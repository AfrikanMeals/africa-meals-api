import {
  extractObjectPath,
  isStorageObjectNotFoundError,
} from './storage-engine.types';

describe('extractObjectPath', () => {
  it('path-style GCS', () => {
    expect(
      extractObjectPath(
        'https://storage.googleapis.com/wise-eat-store/catalog/meal.jpg',
      ),
    ).toBe('catalog/meal.jpg');
  });

  it('virtual-hosted GCS', () => {
    expect(
      extractObjectPath(
        'https://wise-eat-store.storage.googleapis.com/catalog/meal.jpg',
      ),
    ).toBe('catalog/meal.jpg');
  });

  // us-east-1 : hostname `{bucket}.s3.amazonaws.com` (sans région dans le DNS).
  it('virtual-hosted S3 us-east-1', () => {
    expect(
      extractObjectPath(
        'https://wise-eat.s3.amazonaws.com/stores/abc/profile/x.png',
      ),
    ).toBe('stores/abc/profile/x.png');
  });

  it('proxy path', () => {
    expect(
      extractObjectPath(
        'https://api.wise-eat.com/medias/public/catalog/meal.jpg',
      ),
    ).toBe('catalog/meal.jpg');
  });

  // CDN objet : pathname = clé (pas de préfixe bucket).
  it('files.wise-eat.com object CDN', () => {
    expect(
      extractObjectPath(
        'https://files.wise-eat.com/stores/6a501e8400ad78d30fcaac89/products/4f1cd02c-5e6d-49c4-b89d-f9682eb20544.jpg',
      ),
    ).toBe(
      'stores/6a501e8400ad78d30fcaac89/products/4f1cd02c-5e6d-49c4-b89d-f9682eb20544.jpg',
    );
  });

  // Double-proxy : URL CDN entière encodée sous /medias/public/.
  it('unwraps nested CDN URL inside medias/public proxy', () => {
    expect(
      extractObjectPath(
        'https://apis.wise-eat.com/medias/public/https%3A//files.wise-eat.com/stores/abc/products/x.jpg',
      ),
    ).toBe('stores/abc/products/x.jpg');
  });

  it('Firebase download URL (/o/…)', () => {
    expect(
      extractObjectPath(
        'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/stores%2Fabc%2Fprofile%2Fx.webp?alt=media&token=tok',
      ),
    ).toBe('stores/abc/profile/x.webp');
  });

  // Path-style R2 : /{bucket}/{key}
  it('R2 cloudflarestorage path-style', () => {
    expect(
      extractObjectPath(
        'https://acct.r2.cloudflarestorage.com/wise-eat/stores/abc/profile/x.webp',
      ),
    ).toBe('stores/abc/profile/x.webp');
  });

  it('R2 .r2.dev public bucket URL', () => {
    expect(
      extractObjectPath(
        'https://pub-xxx.r2.dev/stores/abc/profile/x.webp',
      ),
    ).toBe('stores/abc/profile/x.webp');
  });

  it('Vercel Blob private URL', () => {
    expect(
      extractObjectPath(
        'https://wise-eat.private.blob.vercel-storage.com/stores/abc/profile/x.webp',
      ),
    ).toBe('stores/abc/profile/x.webp');
  });
});

describe('isStorageObjectNotFoundError', () => {
  // AWS SDK v3 GetObject manquant — le proxy doit enchaîner MinIO/GCS/CDN.
  it('detects AWS SDK NoSuchKey by name', () => {
    expect(
      isStorageObjectNotFoundError({
        name: 'NoSuchKey',
        message: 'UnknownError',
        $metadata: { httpStatusCode: 404 },
      }),
    ).toBe(true);
  });

  it('does not treat AccessDenied as missing object', () => {
    expect(
      isStorageObjectNotFoundError({
        name: 'AccessDenied',
        message: 'Access Denied',
        $metadata: { httpStatusCode: 403 },
      }),
    ).toBe(false);
  });
});
