import { Injectable, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { SseRedisPublishService } from '../../common/sse/sse-redis-publish.service';

export type FleetAgentSnapshot = {
  agentUserId: string;
  presence?: string;
  availability?: string;
  activeOrderCount?: number;
  maxConcurrentOrders?: number;
  latitude?: number;
  longitude?: number;
  orderId?: string;
  updatedAt: string;
};

export type FleetSnapshot = {
  type: 'fleet';
  agents: FleetAgentSnapshot[];
  updatedAt: string;
};

@Injectable()
export class FleetSnapshotService {
  private readonly agents = new Map<string, FleetAgentSnapshot>();
  private readonly subject = new Subject<FleetSnapshot>();

  constructor(
    @Optional() private readonly sseRedis?: SseRedisPublishService,
  ) {}

  observe(): Observable<FleetSnapshot> {
    return new Observable((subscriber) => {
      subscriber.next(this.snapshot());
      const sub = this.subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  snapshot(): FleetSnapshot {
    return {
      type: 'fleet',
      agents: [...this.agents.values()],
      updatedAt: new Date().toISOString(),
    };
  }

  pushAgentUpdate(partial: Partial<FleetAgentSnapshot> & { agentUserId: string }): void {
    const id = partial.agentUserId.trim();
    if (!id) return;
    const prev = this.agents.get(id);
    const next: FleetAgentSnapshot = {
      agentUserId: id,
      updatedAt: new Date().toISOString(),
      ...prev,
      ...partial,
    };
    this.agents.set(id, next);
    this.broadcastSnapshot();
  }

  /** Charge l'état initial depuis la base (dashboard livreurs). */
  seedAgents(rows: FleetAgentSnapshot[]): void {
    for (const row of rows) {
      if (!row.agentUserId) continue;
      this.agents.set(row.agentUserId, {
        ...row,
        updatedAt: row.updatedAt ?? new Date().toISOString(),
      });
    }
    this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    const snapshot = this.snapshot();
    this.subject.next(snapshot);
    void this.sseRedis?.publishFleet(
      snapshot as unknown as Record<string, unknown>,
    );
  }
}
