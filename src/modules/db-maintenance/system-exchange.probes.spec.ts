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
    });

    it('uses /health on dedicated api host', () => {
      expect(resolveApiHealthProbeUrl('https://api.wise-eat.com')).toBe(
        'https://api.wise-eat.com/health',
      );
      expect(resolveApiHealthProbeUrl('https://api-dev.wise-eat.com')).toBe(
        'https://api-dev.wise-eat.com/health',
      );
    });
  });
});
