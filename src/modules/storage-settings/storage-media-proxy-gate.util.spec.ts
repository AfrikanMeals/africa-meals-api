import {
  resolveMediaProxyEnabledForPool,
  storagePoolRequiresMediaProxy,
} from './storage-media-proxy-gate.util';

describe('storage-media-proxy-gate.util', () => {
  it('détecte GCS dans le pool', () => {
    expect(storagePoolRequiresMediaProxy(['firebase', 'gcs'])).toBe(true);
    expect(storagePoolRequiresMediaProxy(['firebase', 's3'])).toBe(false);
    expect(storagePoolRequiresMediaProxy([])).toBe(false);
  });

  it('force proxy ON si GCS', () => {
    expect(
      resolveMediaProxyEnabledForPool({
        requested: false,
        storageEnginePool: ['gcs'],
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
