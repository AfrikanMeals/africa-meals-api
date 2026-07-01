import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import {
  SearchReindexProgressService,
  SearchReindexProgressEvent,
} from '@modules/search-settings/search-reindex-progress.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Observable, interval, from, merge, of } from 'rxjs';
import {
  switchMap,
  startWith,
  map,
  distinctUntilChanged,
  take,
} from 'rxjs/operators';
import { sseHealthDedupKey } from './sse-health-dedup.util';
import { SseStreamService } from './sse-stream.service';
import { MessageEvent } from '@nestjs/common';
import { AdminJobProgressService } from '@modules/admin-jobs/admin-job-progress.service';
import { FleetBootstrapService } from '@modules/fleet/fleet-bootstrap.service';
import { FleetSnapshotService } from '@modules/fleet/fleet-snapshot.service';
import { CheckoutSessionSseService } from './checkout-session-sse.service';
import { PlatformMaintenanceSseService } from '@modules/maintenance-alerts/platform-maintenance-sse.service';
import { PlatformMaintenanceService } from '@modules/maintenance-alerts/platform-maintenance.service';

@Injectable()
export class SseStreamSourcesService {
  constructor(
    private readonly sse: SseStreamService,
    private readonly reindexProgress: SearchReindexProgressService,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly fleetSnapshot: FleetSnapshotService,
    private readonly fleetBootstrap: FleetBootstrapService,
    private readonly adminJobs: AdminJobProgressService,
    private readonly checkoutSse: CheckoutSessionSseService,
    private readonly platformMaintenanceSse: PlatformMaintenanceSseService,
    private readonly platformMaintenance: PlatformMaintenanceService,
  ) {}

  assertAdmin(user: UserModel): void {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  reindexProgressStream(user: UserModel): Observable<MessageEvent> {
    this.assertAdmin(user);
    const userId = String((user as { _id?: unknown; id?: unknown })._id ?? user.id);
    return this.sse.stream({
      userId,
      eventName: 'progress',
      source$: this.reindexProgress.observe(),
      completeWhen: (p) =>
        !p.running &&
        p.label !== 'idle' &&
        (p.phase === 'complete' || p.phase === 'error'),
    });
  }

  systemHealthStream(user: UserModel): Observable<MessageEvent> {
    this.assertAdmin(user);
    const userId = String((user as { _id?: unknown; id?: unknown })._id ?? user.id);

    const poll$ = interval(7000).pipe(
      startWith(0),
      switchMap(() => from(this.dbMaintenance.getInfraMqttStatusInternal())),
      map((mqtt) => ({ type: 'mqtt', mqtt, checkedAt: new Date().toISOString() })),
      distinctUntilChanged(
        (a, b) => sseHealthDedupKey(a) === sseHealthDedupKey(b),
      ),
    );

    return this.sse.stream({
      userId,
      eventName: 'health',
      source$: poll$,
    });
  }

  publicStatusStream(): Observable<MessageEvent> {
    // Sondes statut publiques désactivées en SSE — utiliser le bouton Actualiser sur /status.
    return this.sse.stream({
      eventName: 'status',
      source$: of({
        type: 'status',
        manualOnly: true,
        checkedAt: new Date().toISOString(),
        summary: 'checking',
        services: [],
        infra: [],
      }),
    });
  }

  fleetStream(user: UserModel): Observable<MessageEvent> {
    const userId = String((user as { _id?: unknown; id?: unknown })._id ?? user.id);

    if (user.type === UserTypeEnum.ADMIN) {
      void this.fleetBootstrap.refreshFromDatabase();
      return this.sse.stream({
        userId,
        eventName: 'fleet',
        source$: this.fleetSnapshot.observe().pipe(
          map((snapshot) => snapshot as unknown as Record<string, unknown>),
        ),
      });
    }

    if (user.type === UserTypeEnum.VENDOR) {
      const vendorStoreIds = new Set(
        (user.stores ?? [])
          .map((s) => {
            if (typeof s === 'object' && s !== null && '_id' in s) {
              return String((s as { _id: unknown })._id ?? '').trim();
            }
            return String(s ?? '').trim();
          })
          .filter((id) => id.length > 0),
      );
      return this.sse.stream({
        userId,
        eventName: 'fleet',
        source$: this.fleetSnapshot.observe().pipe(
          map((snapshot) => {
            const agents = snapshot.agents.filter((agent) => {
              const audience = agent.notifyStoreIds ?? [];
              if (
                audience.some((storeId) => vendorStoreIds.has(String(storeId)))
              ) {
                return true;
              }
              return false;
            });
            return {
              ...snapshot,
              agents,
            } as unknown as Record<string, unknown>;
          }),
        ),
      });
    }

    throw new ForbiddenException('admin_only');
  }

  adminJobStream(user: UserModel, jobId: string): Observable<MessageEvent> {
    this.assertAdmin(user);
    const userId = String((user as { _id?: unknown; id?: unknown })._id ?? user.id);
    const id = jobId.trim();
    return this.sse.stream({
      userId,
      eventName: 'progress',
      source$: this.adminJobs.observe(id).pipe(
        map((snapshot) => snapshot as unknown as Record<string, unknown>),
      ),
      completeWhen: (p) =>
        p.running === false &&
        (p.phase === 'complete' || p.phase === 'error'),
    });
  }

  checkoutSessionStream(sessionId: string): Observable<MessageEvent> {
    const id = sessionId.trim();
    return this.sse.stream({
      eventName: 'checkout',
      source$: this.checkoutSse.observe(id).pipe(
        map((event) => event as unknown as Record<string, unknown>),
      ),
      completeWhen: (p) =>
        p.type === 'checkout_completed' ||
        p.type === 'subscription_completed',
    });
  }

  platformMaintenanceStream(): Observable<MessageEvent> {
    const seed$ = of(null).pipe(
      switchMap(() => from(this.platformMaintenance.getPublicStatus())),
      map((snapshot) => ({ type: 'maintenance', ...snapshot })),
    );
    const live$ = this.platformMaintenanceSse.observe().pipe(
      map((snapshot) => ({ type: 'maintenance', ...snapshot })),
    );
    return this.sse.stream({
      eventName: 'maintenance',
      source$: merge(seed$.pipe(take(1)), live$),
    });
  }
}

export type { SearchReindexProgressEvent };
