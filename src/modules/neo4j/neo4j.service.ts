import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
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

  async onModuleInit(): Promise<void> {
    await this.ensureDriver();
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeDriver();
  }

  /** État health : never throws (fail-open ops). */
  async getHealthState(): Promise<Neo4jHealthState> {
    if (!isNeo4jEnabled()) {
      return 'disabled';
    }
    const ok = await this.probeConnectivity();
    return ok ? 'up' : 'down';
  }

  isHealthy(): boolean {
    if (!isNeo4jEnabled() || !this.driver) return false;
    return this.lastHealthy;
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
    opts?: RunCypherOptions,
  ): Promise<T[]> {
    const driver = await this.ensureDriver();
    if (!driver) {
      throw new Error('neo4j_driver_unavailable');
    }

    const timeoutMs = opts?.timeoutMs ?? parseRecoGraphTimeoutMs();
    const database =
      opts?.database?.trim() ||
      (process.env.NEO4J_DATABASE ?? 'neo4j').trim() ||
      'neo4j';

    const sessionConfig: SessionConfig = { database, defaultAccessMode: neo4j.session.WRITE };
    const session: Session = driver.session(sessionConfig);

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
      return this.recordsToObjects<T>(result);
    } catch (err) {
      this.lastHealthy = false;
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
      // Node / Relationship — expose properties if present
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
