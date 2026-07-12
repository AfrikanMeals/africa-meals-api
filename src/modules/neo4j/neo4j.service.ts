import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import neo4j, {
  Driver,
  Integer,
  QueryResult,
  Session,
  SessionConfig,
} from 'neo4j-driver';
import {
  isNeo4jEnabled,
  parseRecoGraphTimeoutMs,
} from '@modules/graphdb-settings/graph-config.util';
import { GraphMetricsService } from './graph-metrics.service';

export type Neo4jHealthState = 'disabled' | 'up' | 'down';

export type RunCypherOptions = {
  timeoutMs?: number;
  database?: string;
};

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private driver: Driver | null = null;
  private lastHealthy = false;
  private lastProbeAt = 0;

  constructor(@Optional() private readonly metrics?: GraphMetricsService) {}

  async onModuleInit(): Promise<void> {
    // Les flags Admin (Mongo) peuvent arriver juste après via GraphdbSettingsService.
    // Connexion lazy : syncWithRuntimeFlags / ensureDriver à l’usage.
    await this.syncWithRuntimeFlags();
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeDriver();
  }

  /**
   * Aligne le driver sur les flags effectifs (env + overrides Admin runtime).
   * À appeler après PUT GraphDB / bootstrap settings.
   */
  async syncWithRuntimeFlags(): Promise<Neo4jHealthState> {
    if (!isNeo4jEnabled()) {
      if (this.driver) {
        this.logger.log('Neo4j disabled (runtime) — closing driver');
        await this.closeDriver();
      }
      return 'disabled';
    }
    const driver = await this.ensureDriver();
    return driver && this.lastHealthy ? 'up' : 'down';
  }

  /** État health : never throws (fail-open ops). */
  async getHealthState(): Promise<Neo4jHealthState> {
    if (!isNeo4jEnabled()) {
      if (this.driver) await this.closeDriver();
      return 'disabled';
    }
    const ok = await this.probeConnectivity();
    return ok ? 'up' : 'down';
  }

  isHealthy(): boolean {
    if (!isNeo4jEnabled() || !this.driver) return false;
    return this.lastHealthy;
  }

  /**
   * Ouvre le driver si flags ON, puis retourne l’état santé courant.
   * Utilisé par la facade reco pour ne pas bloquer sur un driver encore fermé après toggle Admin.
   */
  async ensureHealthy(): Promise<boolean> {
    if (!isNeo4jEnabled()) {
      if (this.driver) await this.closeDriver();
      return false;
    }
    const driver = await this.ensureDriver();
    return Boolean(driver && this.lastHealthy);
  }

  async ensureDriver(): Promise<Driver | null> {
    if (!isNeo4jEnabled()) {
      if (this.driver) await this.closeDriver();
      return null;
    }
    if (this.driver) return this.driver;

    const uri = (process.env.NEO4J_URI ?? '').trim();
    const user = (process.env.NEO4J_USER ?? 'neo4j').trim() || 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? '';
    if (!uri) {
      this.logger.warn('NEO4J_ENABLED but NEO4J_URI missing — driver not opened');
      this.lastHealthy = false;
      return null;
    }

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        disableLosslessIntegers: true,
      });
      await this.driver.verifyConnectivity();
      this.lastHealthy = true;
      this.lastProbeAt = Date.now();
      this.logger.log(`Neo4j driver connected (${uri})`);
      return this.driver;
    } catch (err) {
      this.lastHealthy = false;
      this.logger.warn(
        `Neo4j connect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.closeDriver();
      return null;
    }
  }

  async runCypher<T = Record<string, unknown>>(
    query: string,
    params: Record<string, unknown> = {},
    opts?: RunCypherOptions & { op?: string },
  ): Promise<T[]> {
    const driver = await this.ensureDriver();
    if (!driver) {
      this.metrics?.recordCypher({
        op: opts?.op ?? 'query',
        ok: false,
        latencyMs: 0,
      });
      throw new Error('neo4j_driver_unavailable');
    }

    const timeoutMs = opts?.timeoutMs ?? parseRecoGraphTimeoutMs();
    const database =
      opts?.database?.trim() ||
      (process.env.NEO4J_DATABASE ?? 'neo4j').trim() ||
      'neo4j';
    const op = (opts?.op ?? 'query').slice(0, 64);

    const sessionConfig: SessionConfig = {
      database,
      defaultAccessMode: neo4j.session.WRITE,
    };
    const session: Session = driver.session(sessionConfig);
    const t0 = Date.now();

    try {
      const result = await Promise.race([
        session.run(query, params, {
          timeout: timeoutMs > 0 ? timeoutMs : undefined,
        }),
        new Promise<never>((_, reject) => {
          if (timeoutMs <= 0) return;
          setTimeout(
            () => reject(new Error('neo4j_query_timeout')),
            timeoutMs,
          );
        }),
      ]);
      this.lastHealthy = true;
      this.lastProbeAt = Date.now();
      this.metrics?.recordCypher({
        op,
        ok: true,
        latencyMs: Date.now() - t0,
      });
      return this.recordsToObjects<T>(result);
    } catch (err) {
      this.lastHealthy = false;
      this.metrics?.recordCypher({
        op,
        ok: false,
        latencyMs: Date.now() - t0,
      });
      throw err;
    } finally {
      await session.close();
    }
  }

  private recordsToObjects<T>(result: QueryResult): T[] {
    return result.records.map((rec) => {
      const obj: Record<string, unknown> = {};
      for (const key of rec.keys) {
        const k = String(key);
        obj[k] = this.normalizeValue(rec.get(k));
      }
      return obj as T;
    });
  }

  private normalizeValue(value: unknown): unknown {
    if (value == null) return value;
    if (neo4j.isInt(value) || value instanceof Integer) {
      return (value as Integer).toNumber();
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.normalizeValue(v));
    }
    if (typeof value === 'object') {
      const maybe = value as { properties?: Record<string, unknown> };
      if (maybe.properties && typeof maybe.properties === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(maybe.properties)) {
          out[k] = this.normalizeValue(v);
        }
        return out;
      }
    }
    return value;
  }

  private async probeConnectivity(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastProbeAt < 5_000 && this.driver) {
      return this.lastHealthy;
    }
    const driver = await this.ensureDriver();
    if (!driver) {
      this.lastHealthy = false;
      this.lastProbeAt = now;
      return false;
    }
    try {
      await driver.verifyConnectivity();
      this.lastHealthy = true;
      this.lastProbeAt = now;
      return true;
    } catch {
      this.lastHealthy = false;
      this.lastProbeAt = now;
      return false;
    }
  }

  private async closeDriver(): Promise<void> {
    if (!this.driver) return;
    try {
      await this.driver.close();
    } catch {
      /* ignore */
    }
    this.driver = null;
    this.lastHealthy = false;
  }
}
