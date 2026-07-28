import { buildDocumentMediaUrlUpdates } from './media-url-normalize.util';
import type { StorageMediaField } from './storage-media-inventory.constants';

const S3_HOST = 'https://wise-eat.s3.amazonaws.com';
const PROXY = 'https://api.wise-eat.com/medias/public';

/** Réécriture simulant `resolvePublicMediaUrl` avec un bucket S3 privé. */
const toProxy = async (url: string): Promise<string | undefined> => {
  if (!url.startsWith(S3_HOST)) return url;
  return `${PROXY}${url.slice(S3_HOST.length)}`;
};

describe('buildDocumentMediaUrlUpdates', () => {
  it('rewrites a scalar field', async () => {
    const fields: StorageMediaField[] = [
      { kind: 'scalar', field: 'profile_image' },
    ];
    await expect(
      buildDocumentMediaUrlUpdates(
        { profile_image: `${S3_HOST}/stores/a/profile/x.png` },
        fields,
        toProxy,
      ),
    ).resolves.toEqual({
      profile_image: `${PROXY}/stores/a/profile/x.png`,
    });
  });

  it('rewrites object arrays with their positional path', async () => {
    const fields: StorageMediaField[] = [
      { kind: 'array', arrayField: 'gallery_images', urlField: 'imageUrl' },
    ];
    await expect(
      buildDocumentMediaUrlUpdates(
        {
          gallery_images: [
            { imageUrl: `${S3_HOST}/a.png` },
            { imageUrl: 'https://cdn.other.com/b.png' },
            { imageUrl: `${S3_HOST}/c.png` },
          ],
        },
        fields,
        toProxy,
      ),
    ).resolves.toEqual({
      'gallery_images.0.imageUrl': `${PROXY}/a.png`,
      'gallery_images.2.imageUrl': `${PROXY}/c.png`,
    });
  });

  it('rewrites raw string arrays (preuves de dépôt livreur)', async () => {
    const fields: StorageMediaField[] = [
      { kind: 'stringArray', field: 'proof_photo_urls' },
    ];
    await expect(
      buildDocumentMediaUrlUpdates(
        {
          proof_photo_urls: [
            `${S3_HOST}/delivery-proof/1.jpg`,
            `${S3_HOST}/delivery-proof/2.jpg`,
          ],
        },
        fields,
        toProxy,
      ),
    ).resolves.toEqual({
      'proof_photo_urls.0': `${PROXY}/delivery-proof/1.jpg`,
      'proof_photo_urls.1': `${PROXY}/delivery-proof/2.jpg`,
    });
  });

  it('produces no update when URLs already point at the proxy (idempotence)', async () => {
    const fields: StorageMediaField[] = [
      { kind: 'scalar', field: 'imageUrl' },
      { kind: 'stringArray', field: 'proof_photo_urls' },
    ];
    await expect(
      buildDocumentMediaUrlUpdates(
        {
          imageUrl: `${PROXY}/marketing/ads/x.png`,
          proof_photo_urls: [`${PROXY}/delivery-proof/1.jpg`],
        },
        fields,
        toProxy,
      ),
    ).resolves.toEqual({});
  });

  it('ignores empty, missing and non-string values', async () => {
    const fields: StorageMediaField[] = [
      { kind: 'scalar', field: 'profile_image' },
      { kind: 'scalar', field: 'absent' },
      { kind: 'array', arrayField: 'gallery_images', urlField: 'imageUrl' },
      { kind: 'stringArray', field: 'proof_photo_urls' },
    ];
    await expect(
      buildDocumentMediaUrlUpdates(
        {
          profile_image: '   ',
          gallery_images: [null, 'not-an-object', { imageUrl: 42 }],
          proof_photo_urls: 'pas-un-tableau',
        },
        fields,
        toProxy,
      ),
    ).resolves.toEqual({});
  });

  it('keeps the stored value when the rewrite yields nothing', async () => {
    const fields: StorageMediaField[] = [
      { kind: 'scalar', field: 'imageUrl' },
    ];
    await expect(
      buildDocumentMediaUrlUpdates(
        { imageUrl: `${S3_HOST}/a.png` },
        fields,
        async () => undefined,
      ),
    ).resolves.toEqual({});
  });
});
