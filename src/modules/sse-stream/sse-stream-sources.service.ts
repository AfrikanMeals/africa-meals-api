import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import {
  SearchReindexProgressService,
  SearchReindexProgressEvent,
} from '@modules/search-settings/search-reindex-progress.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Observable, interval, from, merge } from 'rxjs';
import { switchMap, startWith, map, distinctUntilChanged } from 'rxjs/operators';
import { sseHealthDedupKey } from './sse-health-dedup.util';
import { PublicStatusProbeService, PublicStatusSnapshot } from './public-status-probe.service';
import { SseStreamService } from './sse-stream.service';
import { MessageEvent } from '@nestjs/common';
import { AdminJobProgressService } from '@modules/admin-jobs/admin-job-progress.service';
import { FleetBootstrapService } from '@modules/fleet/fleet-bootstrap.service';
import { FleetSnapshotService } from '@modules/fleet/fleet-snapshot.service';
import { CheckoutSessionSseService } from './checkout-session-sse.service';

@Injectable()
export class SseStreamSourcesService {
  constructor(
    private readonly sse: SseStreamService,
    private readonly reindexProgress: SearchReindexProgressService,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly statusProbes: PublicStatusProbeService,
    private readonly fleetSnapshot: FleetSnapshotService,
    private readonly fleetBootstrap: FleetBootstrapService,
    private readonly adminJobs: AdminJobProgressService,
    private readonly checkoutSse: CheckoutSessionSseService,
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

    const mqtt$ = interval(7000).pipe(
      startWith(0),
      switchMap(() => from(this.dbMaintenance.getInfraMqttStatusInternal())),
      map((mqtt) => ({ type: 'mqtt', mqtt, checkedAt: new Date().toISOString() })),
    );

    const checks$ = interval(120_000).pipe(
      startWith(0),
      switchMap(() => from(this.buildHealthChecksPayload())),
      map((payload) => payload as Record<string, unknown>),
    );

    const poll$ = merge(mqtt$, checks$).pipe(
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

  private async buildHealthChecksPayload(): Promise<Record<string, unknown>> {
    const [checks, runtime] = await Promise.all([
      this.dbMaintenance.runAllSystemHealthChecksInternal(),
      this.dbMaintenance.getInfraRuntimeSettingsInternal(),
    ]);
    return {
      type: 'snapshot',
      runtime,
      checks,
      checkedAt: new Date().toISOString(),
    };
  }

  publicStatusStream(): Observable<MessageEvent> {
    const poll$ = interval(60_000).pipe(
      startWith(0),
      switchMap(() => from(this.statusProbes.probeAll())),
      map((snapshot: PublicStatusSnapshot) => ({ type: 'status', ...snapshot })),
    );

    return this.sse.stream({
      eventName: 'status',
      source$: poll$,
    });
  }

  fleetStream(user: UserModel): Observable<MessageEvent> {
    this.assertAdmin(user);
    void this.fleetBootstrap.refreshFromDatabase();
    const userId = String((user as { _id?: unknown; id?: unknown })._id ?? user.id);
    return this.sse.stream({
      userId,
      eventName: 'fleet',
      source$: this.fleetSnapshot.observe().pipe(
        map((snapshot) => snapshot as unknown as Record<string, unknown>),
      ),
    });
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
}

export type { SearchReindexProgressEvent };
