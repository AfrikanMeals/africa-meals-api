import {
  resolveApiHealthProbeUrl,
  resolveMinioHealthProbeSkipReason,
} from './system-exchange.probes';
import type { ConfigService } from '@nestjs/config';

function mockConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('system-exchange.probes', () => {
  describe('resolveMinioHealthProbeSkipReason', () => {
    it('skips when MinIO shares the API listen port on localhost', () => {
      expect(
        resolveMinioHealthProbeSkipReason(
          mockConfig({
            MINIO_ENDPOINT: 'http://localhost:9000',
            PORT: '9000',
          }),
        ),
      ).toContain('partage le port 9000');
    });

    it('does not skip when MinIO uses a different local port', () => {
      expect(
        resolveMinioHealthProbeSkipReason(
          mockConfig({
            MINIO_ENDPOINT: 'http://localhost:9100',
            PORT: '9000',
          }),
        ),
      ).toBeNull();
    });

    it('honours MINIO_HEALTH_CHECK=false', () => {
      expect(
        resolveMinioHealthProbeSkipReason(
          mockConfig({ MINIO_HEALTH_CHECK: 'false' }),
        ),
      ).toBe('sonde désactivée (MINIO_HEALTH_CHECK=false)');
    });
  });

  describe('resolveApiHealthProbeUrl', () => {
    it('uses /api/health on localhost Nest dev', () => {
      expect(resolveApiHealthProbeUrl('http://localhost:9001')).toBe(
        'http://localhost:9001/api/health',
      );
      expect(resolveApiHealthProbeUrl('http://localhost:9001/api')).toBe(
        'http://localhost:9001/api/health',
      );
    });

    it('uses /api/health on VPS k8s api host', () => {
      expect(resolveApiHealthProbeUrl('https://api.wise-eat.com')).toBe(
        'https://api.wise-eat.com/api/health',
      );
      expect(resolveApiHealthProbeUrl('https://api-dev.wise-eat.com')).toBe(
        'https://api-dev.wise-eat.com/api/health',
      );
    });

    it('uses /health on Worker façade apis.wise-eat.com', () => {
      expect(resolveApiHealthProbeUrl('https://apis.wise-eat.com')).toBe(
        'https://apis.wise-eat.com/health',
      );
    });

    it('uses /health on Cloud Functions host', () => {
      expect(
        resolveApiHealthProbeUrl(
          'https://us-east1-wise-eat-com.cloudfunctions.net/api',
        ),
      ).toBe('https://us-east1-wise-eat-com.cloudfunctions.net/health');
    });
  });
});
