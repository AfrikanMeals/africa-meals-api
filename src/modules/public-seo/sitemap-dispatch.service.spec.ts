import { ConfigService } from '@nestjs/config';
import { SitemapDispatchService } from './sitemap-dispatch.service';

describe('SitemapDispatchService', () => {
  function svc(env: Record<string, string | undefined>) {
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    return new SitemapDispatchService(config);
  }

  it('isConfigured returns false when token or repo missing', () => {
    expect(svc({}).isConfigured()).toBe(false);
    expect(
      svc({ GITHUB_SITEMAP_DISPATCH_TOKEN: 'ghp_x' }).isConfigured(),
    ).toBe(false);
    expect(
      svc({ GITHUB_SITEMAP_DISPATCH_REPO: 'org/web' }).isConfigured(),
    ).toBe(false);
  });

  it('isConfigured returns true when token and repo set', () => {
    expect(
      svc({
        GITHUB_SITEMAP_DISPATCH_TOKEN: 'ghp_test',
        GITHUB_SITEMAP_DISPATCH_REPO: 'WiseEat/africa-meals-web',
      }).isConfigured(),
    ).toBe(true);
  });

  it('requestRegenerate is no-op when not configured', () => {
    jest.useFakeTimers();
    const service = svc({});
    expect(() => service.requestRegenerate('store_activated')).not.toThrow();
    jest.runAllTimers();
    jest.useRealTimers();
  });
});
