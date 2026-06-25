import { ConfigService } from '@nestjs/config';
import type { S3ClientConfig } from '@aws-sdk/client-s3';

export function normalizeMinioEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
}

export function parseMinioReplicaEndpoints(config: ConfigService): string[] {
  const csv = config.get<string>('MINIO_REPLICA_ENDPOINTS')?.trim() ?? '';
  if (!csv) return [];
  return csv
    .split(',')
    .map((part) => normalizeMinioEndpoint(part))
    .filter(Boolean);
}

/** Primary first, puis réplicas (dédupliqués). */
export function parseMinioEndpoints(config: ConfigService): string[] {
  const primary = normalizeMinioEndpoint(
    config.get<string>('MINIO_ENDPOINT')?.trim() ?? '',
  );
  const replicas = parseMinioReplicaEndpoints(config);
  const seen = new Set<string>();
  const endpoints: string[] = [];
  for (const endpoint of [primary, ...replicas]) {
    if (!endpoint || seen.has(endpoint)) continue;
    seen.add(endpoint);
    endpoints.push(endpoint);
  }
  return endpoints;
}

export function buildMinioS3ClientConfig(
  config: ConfigService,
  endpoint: string,
): S3ClientConfig {
  const region = config.get<string>('MINIO_REGION')?.trim() || 'us-east-1';
  const forcePathStyle =
    config.get<string>('MINIO_FORCE_PATH_STYLE')?.trim() !== 'false';
  return {
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: config.get<string>('MINIO_ACCESS_KEY')!.trim(),
      secretAccessKey: config.get<string>('MINIO_SECRET_KEY')!.trim(),
    },
  };
}
