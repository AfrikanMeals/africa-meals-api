import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Injectable, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  Neo4jService,
  type Neo4jHealthState,
} from '@modules/neo4j/neo4j.service';

export type HealthProcessMemory = {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
};

export type HealthProcess = {
  pid: number;
  node: string;
  platform: string;
  arch: string;
  memory: HealthProcessMemory;
  /** CPU cumulatif depuis le démarrage du processus (µs). */
  cpu: { userMicros: number; systemMicros: number };
};

export type HealthMongodb = {
  reachable: boolean;
  /** Latence du dernier `ping` admin (ms). */
  pingMs?: number;
  /** Mongoose : 0 déconnecté, 1 connecté, 2 connecting, 3 disconnecting. */
  readyState?: number;
  /** Nom de connexion Mongoose (diagnostic). */
  name?: string;
  error?: string;
};

export type HealthRuntime = {
  /** Limite mémoire cgroup si lisible (octets), p.ex. Cloud Run / GKE. */
  cgroupMemoryLimitBytes: number | null;
  /** Métadonnées d’exécution Cloud Run (non sensibles). */
  cloudRun?: { service?: string; revision?: string };
  nodeEnv?: string;
};

export type HealthPayload = {
  /**
   * `ok` : processus vivant et MongoDB répond au ping.
   * `degraded` : API up mais base injoignable ou ping en échec (toujours HTTP 200).
   * Neo4j down n’altère jamais le status global (fail-open ops).
   */
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  process: HealthProcess;
  mongodb: HealthMongodb;
  /** `disabled` | `up` | `down` — indépendant du status HTTP. */
  neo4j: Neo4jHealthState;
  runtime: HealthRuntime;
};

/** Best-effort : limite mémoire du conteneur (cgroup v2/v1), sinon `null`. */
function readCgroupMemoryLimitBytes(): number | null {
  const candidates = [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf8').trim();
      if (raw === 'max' || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n < Number.MAX_SAFE_INTEGER) {
        return n;
      }
    } catch {
      /* fichier absent (hors Linux / hors conteneur) */
    }
  }
  return null;
}

@Injectable()
export class AppService {
  constructor(
    @InjectConnection() private readonly _mongo: Connection,
    @Optional() private readonly _neo4j?: Neo4jService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<HealthPayload> {
    let version = '0.0.0';
    try {
      const pkgPath = join(__dirname, '..', 'package.json');
      const raw = readFileSync(pkgPath, 'utf8');
      version = (JSON.parse(raw) as { version?: string }).version ?? version;
    } catch {
      // dist path ou package absent
    }

    const m = process.memoryUsage();
    const cpu = process.cpuUsage();

    const processBlock: HealthProcess = {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        rssBytes: m.rss,
        heapTotalBytes: m.heapTotal,
        heapUsedBytes: m.heapUsed,
        externalBytes: m.external,
        arrayBuffersBytes: m.arrayBuffers ?? 0,
      },
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system,
      },
    };

    const cgroupMemoryLimitBytes = readCgroupMemoryLimitBytes();
    const kService = process.env.K_SERVICE?.trim();
    const kRevision = process.env.K_REVISION?.trim();
    const runtime: HealthRuntime = {
      cgroupMemoryLimitBytes,
      nodeEnv: process.env.NODE_ENV,
      ...(kService || kRevision
        ? {
            cloudRun: {
              ...(kService ? { service: kService } : {}),
              ...(kRevision ? { revision: kRevision } : {}),
            },
          }
        : {}),
    };

    const mongodb: HealthMongodb = {
      reachable: false,
      readyState: this._mongo.readyState,
      name: this._mongo.name,
    };

    try {
      const db = this._mongo.db;
      if (db == null) {
        mongodb.error = 'no_db_handle';
      } else {
        const t0 = performance.now();
        await db.admin().command({ ping: 1 });
        mongodb.reachable = true;
        mongodb.pingMs = Math.round((performance.now() - t0) * 1000) / 1000;
      }
    } catch (e) {
      mongodb.reachable = false;
      mongodb.error = (e as Error).message;
    }

    const status: HealthPayload['status'] = mongodb.reachable
      ? 'ok'
      : 'degraded';

    let neo4j: Neo4jHealthState = 'disabled';
    try {
      neo4j = this._neo4j
        ? await this._neo4j.getHealthState()
        : 'disabled';
    } catch {
      neo4j = 'down';
    }

    return {
      status,
      service: 'africa-meals-api',
      version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
      process: processBlock,
      mongodb,
      neo4j,
      runtime,
    };
  }
}
