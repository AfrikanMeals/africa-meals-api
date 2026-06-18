import type { ConfigService } from '@nestjs/config';
import {
  isDevStatusProbeStack,
  resolveAdminProbeEndpointUrl,
  resolveAdminProbeHealthUrl,
  resolveWebProbeEndpointUrl,
  resolveWebProbeUrl,
  resolveWsProbeEndpointUrl,
  resolveWsProbeFetchUrl,
} from './status-probe-urls.util';

describe('status-probe-urls.util', () => {
  const mockConfig = (values: Record<string, string | undefined>) =>
    ({
      get: (key: string) => values[key],
    }) as ConfigService;

  it('uses localhost WS fetch when dev stack and internal WS is local', () => {
    expect(
      resolveWsProbeFetchUrl(
        mockConfig({
          NODE_ENV: 'development',
          AFRICA_MEALS_WS_INTERNAL_URL: 'http://localhost:8000',
          WS_BASE_URL: 'https://ws.wise-eat.com',
        }),
      ),
    ).toBe('http://localhost:8000/api/health');
  });

  it('shows ws-dev public endpoint in dev stack', () => {
    expect(
      resolveWsProbeEndpointUrl(
        mockConfig({
          NODE_ENV: 'development',
          AFRICA_MEALS_WS_INTERNAL_URL: 'http://localhost:8000',
        }),
      ),
    ).toBe('https://ws-dev.wise-eat.com/api/health');
  });

  it('ignores production WS_BASE_URL on api-dev internal base', () => {
    expect(
      resolveWsProbeFetchUrl(
        mockConfig({
          NODE_ENV: 'production',
          AFRICA_MEALS_API_INTERNAL_BASE_URL: 'https://api-dev.wise-eat.com/api',
          AFRICA_MEALS_WS_INTERNAL_URL: 'http://localhost:8000',
          WS_BASE_URL: 'https://ws.wise-eat.com',
        }),
      ),
    ).toBe('http://localhost:8000/api/health');
  });

  it('uses localhost admin health in development', () => {
    expect(
      resolveAdminProbeHealthUrl(
        mockConfig({
          NODE_ENV: 'development',
          STATUS_PROBE_ADMIN_URL: 'https://admin.wise-eat.com/',
        }),
      ),
    ).toBe('http://localhost:3001/api/health');
  });

  it('shows dashboard public endpoint in dev stack', () => {
    expect(
      resolveAdminProbeEndpointUrl(
        mockConfig({
          NODE_ENV: 'development',
          STATUS_PROBE_ADMIN_URL: 'https://admin.wise-eat.com/',
        }),
      ),
    ).toBe('https://dashboard.wise-eat.com/api/health');
  });

  it('normalizes STATUS_PROBE_ADMIN_URL to /api/health in production', () => {
    expect(
      resolveAdminProbeHealthUrl(
        mockConfig({
          NODE_ENV: 'production',
          STATUS_PROBE_ADMIN_URL: 'https://admin.wise-eat.com',
        }),
      ),
    ).toBe('https://admin.wise-eat.com/api/health');
  });

  it('detects dev stack from SERVER_URL localhost', () => {
    expect(
      isDevStatusProbeStack(
        mockConfig({
          SERVER_URL: 'http://localhost:9000',
          WS_BASE_URL: 'https://ws.wise-eat.com',
        }),
      ),
    ).toBe(true);
  });

  it('prefers dev web endpoint over production STATUS_PROBE_WEB_URL', () => {
    expect(
      resolveWebProbeEndpointUrl(
        mockConfig({
          NODE_ENV: 'development',
          STATUS_PROBE_WEB_URL: 'https://wise-eat.com/',
        }),
      ),
    ).toBe('https://web.wise-eat.com/');
    expect(
      resolveWebProbeUrl(
        mockConfig({
          NODE_ENV: 'development',
          STATUS_PROBE_WEB_URL: 'https://wise-eat.com/',
        }),
      ),
    ).toBe('http://localhost:5002/');
  });
});
