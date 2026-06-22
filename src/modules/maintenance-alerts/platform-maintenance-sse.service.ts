import { SseRedisPublishService } from '../../common/sse/sse-redis-publish.service';
import { Injectable, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { PublicPlatformMaintenanceResponse } from './platform-maintenance.util';

@Injectable()
export class PlatformMaintenanceSseService {
  private readonly subject = new Subject<PublicPlatformMaintenanceResponse>();
  private last: PublicPlatformMaintenanceResponse | null = null;

  constructor(
    @Optional() private readonly sseRedis?: SseRedisPublishService,
  ) {}

  observe(): Observable<PublicPlatformMaintenanceResponse> {
    return new Observable((subscriber) => {
      if (this.last) subscriber.next(this.last);
      const sub = this.subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  lastSnapshot(): PublicPlatformMaintenanceResponse | null {
    return this.last;
  }

  emit(snapshot: PublicPlatformMaintenanceResponse): void {
    this.last = snapshot;
    this.subject.next(snapshot);
    void this.sseRedis?.publishPlatformMaintenance(
      snapshot as unknown as Record<string, unknown>,
    );
  }
}
