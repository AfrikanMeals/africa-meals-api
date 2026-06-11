import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_DEBOUNCE_MS = 120_000;
const GITHUB_API = 'https://api.github.com';
const DISPATCH_EVENT = 'regenerate-sitemap';

@Injectable()
export class SitemapDispatchService {
  private readonly _logger = new Logger(SitemapDispatchService.name);
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastReason = 'catalog_change';

  constructor(private readonly _config: ConfigService) {}

  /** Planifie un `repository_dispatch` GitHub (debounce pour limiter le bruit). */
  requestRegenerate(reason: string): void {
    if (!this.isConfigured()) return;
    this._lastReason = String(reason || 'catalog_change').trim() || 'catalog_change';
    if (this._debounceTimer) return;
    const debounceMs = this.resolveDebounceMs();
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      void this.dispatchNow(this._lastReason);
    }, debounceMs);
  }

  isConfigured(): boolean {
    return Boolean(this.resolveToken() && this.resolveRepo());
  }

  private resolveToken(): string {
    return (
      this._config.get<string>('GITHUB_SITEMAP_DISPATCH_TOKEN')?.trim() ||
      this._config.get<string>('GITHUB_SITEMAP_DISPATCH_PAT')?.trim() ||
      ''
    );
  }

  private resolveRepo(): string {
    return this._config.get<string>('GITHUB_SITEMAP_DISPATCH_REPO')?.trim() || '';
  }

  private resolveDebounceMs(): number {
    const raw = this._config.get<string>('GITHUB_SITEMAP_DISPATCH_DEBOUNCE_MS');
    const n = raw != null ? parseInt(raw, 10) : DEFAULT_DEBOUNCE_MS;
    if (!Number.isFinite(n) || n < 5_000) return DEFAULT_DEBOUNCE_MS;
    return Math.min(n, 900_000);
  }

  private async dispatchNow(reason: string): Promise<void> {
    const token = this.resolveToken();
    const repo = this.resolveRepo();
    if (!token || !repo) return;

    const [owner, name] = repo.split('/').map((s) => s.trim());
    if (!owner || !name) {
      this._logger.warn(
        `sitemap_dispatch_invalid_repo repo=${repo} (attendu: org/africa-meals-web)`,
      );
      return;
    }

    const url = `${GITHUB_API}/repos/${owner}/${name}/dispatches`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: DISPATCH_EVENT,
          client_payload: {
            reason,
            triggeredAt: new Date().toISOString(),
          },
        }),
      });
      if (res.status === 204) {
        this._logger.log(`sitemap_dispatch_ok repo=${repo} reason=${reason}`);
        return;
      }
      const body = await res.text().catch(() => '');
      this._logger.warn(
        `sitemap_dispatch_failed status=${res.status} repo=${repo} reason=${reason} body=${body.slice(0, 240)}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.warn(`sitemap_dispatch_error repo=${repo} reason=${reason} ${msg}`);
    }
  }
}
