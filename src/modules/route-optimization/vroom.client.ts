import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VroomProblem, VroomSolution } from './vroom-problem.util';

@Injectable()
export class VroomClient {
  private readonly logger = new Logger(VroomClient.name);

  constructor(private readonly _config: ConfigService) {}

  baseUrl(): string {
    const raw =
      this._config.get<string>('VROOM_BASE_URL')?.trim() ||
      process.env.VROOM_BASE_URL?.trim() ||
      '';
    return raw.replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return this.baseUrl().length > 0;
  }

  /**
   * POST JSON problème VROOM → solution.
   * Endpoint HTTP standard vroom-docker / vroom-express : `POST /`
   */
  async solve(problem: VroomProblem, signal?: AbortSignal): Promise<VroomSolution> {
    const base = this.baseUrl();
    if (!base) {
      throw new Error('VROOM_BASE_URL non configuré');
    }
    const url = `${base}/`;
    const timeoutMs = this.timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(problem),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: VroomSolution;
      try {
        json = JSON.parse(text) as VroomSolution;
      } catch {
        throw new Error(
          `VROOM réponse non-JSON HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      if (!res.ok && json.code == null) {
        throw new Error(
          `VROOM HTTP ${res.status}: ${json.error ?? text.slice(0, 200)}`,
        );
      }
      return json;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private timeoutMs(): number {
    const n = Number(
      this._config.get<string>('VROOM_TIMEOUT_MS') ??
        process.env.VROOM_TIMEOUT_MS ??
        8_000,
    );
    if (!Number.isFinite(n) || n < 1_000) return 8_000;
    return Math.min(60_000, Math.trunc(n));
  }
}
