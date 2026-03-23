import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';

export type HealthPayload = {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
};

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getHealth(): HealthPayload {
    let version = '0.0.0';
    try {
      const pkgPath = join(__dirname, '..', 'package.json');
      const raw = readFileSync(pkgPath, 'utf8');
      version = (JSON.parse(raw) as { version?: string }).version ?? version;
    } catch {
      // dist path ou package absent
    }
    return {
      status: 'ok',
      service: 'africa-meals-api',
      version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
    };
  }
}
