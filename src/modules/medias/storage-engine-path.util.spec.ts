import { extractObjectPath } from './storage-engine.types';

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
});
