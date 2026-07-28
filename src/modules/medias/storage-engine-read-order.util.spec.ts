import { orderStorageEnginesForRead } from './storage-engine-read-order.util';

describe('orderStorageEnginesForRead', () => {
  it('met le primaire puis le pool avant MinIO', () => {
    expect(
      orderStorageEnginesForRead({
        primaryId: 'minio',
        pool: ['minio', 's3'],
        candidateIds: ['firebase', 'gcs', 's3', 'minio', 'r2'],
      }),
    ).toEqual(['minio', 's3', 'firebase', 'gcs', 'r2']);
  });

  // Objets legacy Firebase/GCS encore servis alors que l’upload courant est MinIO.
  it('essaie Firebase et GCS même si absents du pool', () => {
    expect(
      orderStorageEnginesForRead({
        primaryId: 'minio',
        pool: ['minio'],
        candidateIds: ['firebase', 'gcs', 'minio'],
      }),
    ).toEqual(['minio', 'firebase', 'gcs']);
  });

  it('place R2 et Vercel Blob avant MinIO dans le repli cloud', () => {
    expect(
      orderStorageEnginesForRead({
        primaryId: 'gcs',
        pool: ['gcs'],
        candidateIds: ['gcs', 'r2', 'vercelBlob', 'minio'],
      }),
    ).toEqual(['gcs', 'r2', 'vercelBlob', 'minio']);
  });
});
