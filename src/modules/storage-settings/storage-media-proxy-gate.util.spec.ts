import {
  resolveMediaProxyEnabledForPool,
  storagePoolRequiresMediaProxy,
} from './storage-media-proxy-gate.util';

describe('storage-media-proxy-gate.util', () => {
  it('détecte GCS, S3 ou R2 dans le pool', () => {
    expect(storagePoolRequiresMediaProxy(['firebase', 'gcs'])).toBe(true);
    expect(storagePoolRequiresMediaProxy(['firebase', 's3'])).toBe(true);
    expect(storagePoolRequiresMediaProxy(['s3'])).toBe(true);
    expect(storagePoolRequiresMediaProxy(['r2'])).toBe(true);
    expect(storagePoolRequiresMediaProxy(['vercelBlob'])).toBe(true);
    expect(storagePoolRequiresMediaProxy(['minio'])).toBe(false);
    expect(storagePoolRequiresMediaProxy(['firebase'])).toBe(false);
    expect(storagePoolRequiresMediaProxy([])).toBe(false);
  });

  it('force proxy ON si GCS, S3 ou R2', () => {
    expect(
      resolveMediaProxyEnabledForPool({
        requested: false,
        storageEnginePool: ['gcs'],
      }),
    ).toBe(true);
    expect(
      resolveMediaProxyEnabledForPool({
        requested: false,
        storageEnginePool: ['s3'],
      }),
    ).toBe(true);
    expect(
      resolveMediaProxyEnabledForPool({
        requested: false,
        storageEnginePool: ['r2'],
      }),
    ).toBe(true);
    expect(
      resolveMediaProxyEnabledForPool({
        requested: false,
        storageEnginePool: ['vercelBlob'],
      }),
    ).toBe(true);
    expect(
      resolveMediaProxyEnabledForPool({
        requested: false,
        storageEnginePool: ['firebase'],
      }),
    ).toBe(false);
    expect(
      resolveMediaProxyEnabledForPool({
        requested: true,
        storageEnginePool: ['minio'],
      }),
    ).toBe(true);
  });
});
