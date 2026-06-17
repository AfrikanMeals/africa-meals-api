import { isLargeJsonBodyPath } from './route-aware-body-parser';

describe('route-aware-body-parser', () => {
  it('détecte les routes JSON upload', () => {
    expect(
      isLargeJsonBodyPath({
        originalUrl: '/api/stores/abc/product-json',
      } as any),
    ).toBe(true);
    expect(
      isLargeJsonBodyPath({
        originalUrl: '/api/auth/me/chat-media-json',
      } as any),
    ).toBe(true);
  });

  it('ignore les routes REST classiques', () => {
    expect(
      isLargeJsonBodyPath({
        originalUrl: '/api/auth/login',
      } as any),
    ).toBe(false);
  });
});
