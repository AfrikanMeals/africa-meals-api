import { ConfigService } from '@nestjs/config';
import {
  normalizeMinioEndpoint,
  parseMinioEndpoints,
  parseMinioReplicaEndpoints,
} from './minio-endpoints.util';

function mockConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('minio-endpoints.util', () => {
  it('normalise les endpoints sans schéma', () => {
    expect(normalizeMinioEndpoint('127.0.0.1:9002')).toBe(
      'http://127.0.0.1:9002',
    );
  });

  it('parse les réplicas CSV', () => {
    const config = mockConfig({
      MINIO_REPLICA_ENDPOINTS: 'http://127.0.0.1:9002,http://127.0.0.1:9004',
    });
    expect(parseMinioReplicaEndpoints(config)).toEqual([
      'http://127.0.0.1:9002',
      'http://127.0.0.1:9004',
    ]);
  });

  it('déduplique primaire et réplicas', () => {
    const config = mockConfig({
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_REPLICA_ENDPOINTS: 'http://127.0.0.1:9002,http://127.0.0.1:9000',
    });
    expect(parseMinioEndpoints(config)).toEqual([
      'http://127.0.0.1:9000',
      'http://127.0.0.1:9002',
    ]);
  });
});
