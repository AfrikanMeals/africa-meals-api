import type { ConfigService } from '@nestjs/config';
import {
  isDevStatusProbeStack,
  resolveAdminProbeEndpointUrl,
  resolveAdminProbeHealthUrl,
  resolveAdminPublicUrl,
  resolveGrpcApiDisplayEndpoint,
  resolveGrpcApiProbeHost,
  resolveGrpcWsDisplayEndpoint,
  resolveGrpcWsProbeHost,
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

  it('does not double /api when internal WS base already ends with /api', () => {
    expect(
      resolveWsProbeFetchUrl(
        mockConfig({
          NODE_ENV: 'development',
          AFRICA_MEALS_WS_INTERNAL_URL: 'http://localhost:8000/api',
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

  it('resolveAdminPublicUrl prefers ADMIN_APP_URL over localhost in production', () => {
    expect(
      resolveAdminPublicUrl(
        mockConfig({
          NODE_ENV: 'production',
          SERVER_URL: 'https://api.wise-eat.com',
          ADMIN_APP_URL: 'https://admin.wise-eat.com',
        }),
      ),
    ).toBe('https://admin.wise-eat.com');
  });

  it('resolveAdminPublicUrl derives from STATUS_PROBE_ADMIN_URL when ADMIN_APP_URL absent', () => {
    expect(
      resolveAdminPublicUrl(
        mockConfig({
          NODE_ENV: 'production',
          SERVER_URL: 'https://api.wise-eat.com',
          STATUS_PROBE_ADMIN_URL: 'https://admin.wise-eat.com/api/health',
        }),
      ),
    ).toBe('https://admin.wise-eat.com');
  });

  it('uses k8s internal WS for fetch and public WS_BASE_URL for endpoint', () => {
    expect(
      resolveWsProbeFetchUrl(
        mockConfig({
          NODE_ENV: 'production',
          AFRICA_MEALS_WS_INTERNAL_URL:
            'http://africa-meals-ws.wise-eat.svc.cluster.local:8000',
          WS_BASE_URL: 'https://ws.wise-eat.com',
        }),
      ),
    ).toBe(
      'http://africa-meals-ws.wise-eat.svc.cluster.local:8000/api/health',
    );
    expect(
      resolveWsProbeEndpointUrl(
        mockConfig({
          NODE_ENV: 'production',
          AFRICA_MEALS_WS_INTERNAL_URL:
            'http://africa-meals-ws.wise-eat.svc.cluster.local:8000',
          WS_BASE_URL: 'https://ws.wise-eat.com',
        }),
      ),
    ).toBe('https://ws.wise-eat.com/api/health');
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

  it('resolveGrpcWsProbeHost ignores public ws.wise-eat.com in production', () => {
    expect(
      resolveGrpcWsProbeHost(
        mockConfig({
          NODE_ENV: 'production',
          SERVER_URL: 'https://api.wise-eat.com',
          GRPC_WS_HOST: 'ws.wise-eat.com',
          AFRICA_MEALS_WS_INTERNAL_URL:
            'http://africa-meals-ws.wise-eat.svc.cluster.local:8000',
        }),
      ),
    ).toBe('africa-meals-ws.wise-eat.svc.cluster.local');
    expect(
      resolveGrpcWsDisplayEndpoint(
        mockConfig({
          NODE_ENV: 'production',
          SERVER_URL: 'https://api.wise-eat.com',
          GRPC_WS_HOST: 'ws.wise-eat.com',
          AFRICA_MEALS_WS_INTERNAL_URL:
            'http://africa-meals-ws.wise-eat.svc.cluster.local:8000',
        }),
      ),
    ).toBe('africa-meals-ws.wise-eat.svc.cluster.local:50051');
  });

  it('resolveGrpcApiProbeHost uses loopback when bind is 0.0.0.0', () => {
    expect(
      resolveGrpcApiProbeHost(
        mockConfig({
          GRPC_API_BIND_HOST: '0.0.0.0',
        }),
      ),
    ).toBe('127.0.0.1');
    expect(
      resolveGrpcApiDisplayEndpoint(
        mockConfig({
          NODE_ENV: 'production',
          SERVER_URL: 'https://api.wise-eat.com',
          GRPC_API_PORT: '50052',
        }),
      ),
    ).toBe('africa-meals-api.wise-eat.svc.cluster.local:50052');
  });
});
