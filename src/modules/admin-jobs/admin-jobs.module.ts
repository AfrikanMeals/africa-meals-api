import { Module } from '@nestjs/common';
import { SseRedisModule } from '../../common/sse/sse-redis.module';
import { AdminJobEmitterService } from './admin-job-emitter.service';
import { AdminJobProgressService } from './admin-job-progress.service';

/** Jobs admin (SSE progression) sans dépendre de Fleet / Mailer / Medias. */
@Module({
  imports: [SseRedisModule],
  providers: [AdminJobProgressService, AdminJobEmitterService],
  exports: [AdminJobProgressService, AdminJobEmitterService],
})
export class AdminJobsModule {}
