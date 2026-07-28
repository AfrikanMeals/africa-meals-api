import {
  isDirectPublicReadAvailable,
  isObjectAclRequested,
  StorageEnvReader,
} from './storage-public-access.util';

const envOf =
  (values: Record<string, string | undefined>): StorageEnvReader =>
  (key) =>
    values[key];

describe('storage-public-access.util', () => {
  describe('isObjectAclRequested', () => {
    it('skips the S3 public-read ACL by default (Block all public access)', () => {
      expect(isObjectAclRequested('s3', envOf({}))).toBe(false);
    });

    it('sends the S3 ACL only on explicit opt-in', () => {
      expect(
        isObjectAclRequested('s3', envOf({ AWS_S3_PUBLIC_READ: 'true' })),
      ).toBe(true);
      expect(
        isObjectAclRequested('s3', envOf({ AWS_S3_PUBLIC_READ: 'false' })),
      ).toBe(false);
    });

    it('keeps MinIO enabled by default and honours the opt-out', () => {
      expect(isObjectAclRequested('minio', envOf({}))).toBe(true);
      expect(
        isObjectAclRequested('minio', envOf({ MINIO_PUBLIC_READ: 'false' })),
      ).toBe(false);
    });

    it('honours the STORAGE_OBJECT_ACL kill switch', () => {
      expect(
        isObjectAclRequested(
          'minio',
          envOf({ STORAGE_OBJECT_ACL: 'false', MINIO_PUBLIC_READ: 'true' }),
        ),
      ).toBe(false);
    });

    it('never sends an ACL on engines without object ACL', () => {
      expect(isObjectAclRequested('firebase', envOf({}))).toBe(false);
      expect(isObjectAclRequested('r2', envOf({}))).toBe(false);
    });
  });

  describe('isDirectPublicReadAvailable', () => {
    it('treats a private S3 bucket as unreadable (proxy required)', () => {
      expect(isDirectPublicReadAvailable('s3', envOf({}))).toBe(false);
    });

    it('accepts a public S3 bucket', () => {
      expect(
        isDirectPublicReadAvailable(
          's3',
          envOf({ AWS_S3_PUBLIC_READ: 'true' }),
        ),
      ).toBe(true);
    });

    it('accepts a private S3 bucket fronted by a CDN (CloudFront + OAC)', () => {
      expect(
        isDirectPublicReadAvailable(
          's3',
          envOf({ AWS_S3_PUBLIC_BASE_URL: 'https://cdn.wise-eat.com' }),
        ),
      ).toBe(true);
    });

    it('keeps GCS always proxied (Public Access Prevention)', () => {
      expect(
        isDirectPublicReadAvailable('gcs', envOf({ GCS_PUBLIC_READ: 'true' })),
      ).toBe(false);
    });

    it('keeps Firebase and MinIO readable by default', () => {
      expect(isDirectPublicReadAvailable('firebase', envOf({}))).toBe(true);
      expect(isDirectPublicReadAvailable('minio', envOf({}))).toBe(true);
    });

    it('marks MinIO unreadable when public read is turned off', () => {
      expect(
        isDirectPublicReadAvailable(
          'minio',
          envOf({ MINIO_PUBLIC_READ: 'false' }),
        ),
      ).toBe(false);
    });

    // Endpoint R2 S3-API n’est pas anonyme — proxy obligatoire sans custom domain.
    it('treats R2 without public base as private (proxy required)', () => {
      expect(isDirectPublicReadAvailable('r2', envOf({}))).toBe(false);
    });

    it('accepts R2 behind R2_PUBLIC_BASE_URL (custom domain / CDN)', () => {
      expect(
        isDirectPublicReadAvailable(
          'r2',
          envOf({ R2_PUBLIC_BASE_URL: 'https://media.wise-eat.com' }),
        ),
      ).toBe(true);
    });

    it('treats Vercel Blob private store as unreadable (proxy required)', () => {
      expect(isDirectPublicReadAvailable('vercelBlob', envOf({}))).toBe(false);
    });
  });
});
