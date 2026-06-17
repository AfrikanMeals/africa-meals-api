import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { SseJwtAuthGuard } from './guards/sse-jwt-auth.guard';
import { SseStreamSourcesService } from './sse-stream-sources.service';

const SSE_HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no',
  Connection: 'keep-alive',
} as const;

@ApiTags('sse')
@Controller('sse')
export class SseStreamController {
  constructor(private readonly sources: SseStreamSourcesService) {}

  @Get('search/reindex')
  @Sse()
  @Header('Cache-Control', SSE_HEADERS['Cache-Control'])
  @Header('X-Accel-Buffering', SSE_HEADERS['X-Accel-Buffering'])
  @Header('Connection', SSE_HEADERS.Connection)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'SSE — progression réindexation search (admin)',
  })
  @UseGuards(SseJwtAuthGuard)
  searchReindex(@Req() req: Request): Observable<MessageEvent> {
    return this.sources.reindexProgressStream(req.user as UserModel);
  }

  @Get('admin/system-health')
  @Sse()
  @Header('Cache-Control', SSE_HEADERS['Cache-Control'])
  @Header('X-Accel-Buffering', SSE_HEADERS['X-Accel-Buffering'])
  @Header('Connection', SSE_HEADERS.Connection)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'SSE — santé système admin (checks + MQTT runtime)',
  })
  @UseGuards(SseJwtAuthGuard)
  adminSystemHealth(@Req() req: Request): Observable<MessageEvent> {
    return this.sources.systemHealthStream(req.user as UserModel);
  }

  @Get('public/status')
  @Sse()
  @Header('Cache-Control', SSE_HEADERS['Cache-Control'])
  @Header('X-Accel-Buffering', SSE_HEADERS['X-Accel-Buffering'])
  @Header('Connection', SSE_HEADERS.Connection)
  @ApiOperation({
    summary: 'SSE public — agrégat statut services (sans auth)',
  })
  publicStatus(): Observable<MessageEvent> {
    return this.sources.publicStatusStream();
  }

  @Get('admin/fleet')
  @Sse()
  @Header('Cache-Control', SSE_HEADERS['Cache-Control'])
  @Header('X-Accel-Buffering', SSE_HEADERS['X-Accel-Buffering'])
  @Header('Connection', SSE_HEADERS.Connection)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'SSE — fleet livreurs (admin)' })
  @UseGuards(SseJwtAuthGuard)
  adminFleet(@Req() req: Request): Observable<MessageEvent> {
    return this.sources.fleetStream(req.user as UserModel);
  }

  @Get('admin/jobs/:jobId')
  @Sse()
  @Header('Cache-Control', SSE_HEADERS['Cache-Control'])
  @Header('X-Accel-Buffering', SSE_HEADERS['X-Accel-Buffering'])
  @Header('Connection', SSE_HEADERS.Connection)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'SSE — progression job admin' })
  @UseGuards(SseJwtAuthGuard)
  adminJob(
    @Req() req: Request,
    @Param('jobId') jobId: string,
  ): Observable<MessageEvent> {
    return this.sources.adminJobStream(req.user as UserModel, jobId);
  }

  @Get('public/checkout/:sessionId')
  @Sse()
  @Header('Cache-Control', SSE_HEADERS['Cache-Control'])
  @Header('X-Accel-Buffering', SSE_HEADERS['X-Accel-Buffering'])
  @Header('Connection', SSE_HEADERS.Connection)
  @ApiOperation({ summary: 'SSE public — confirmation checkout Stripe' })
  publicCheckout(@Param('sessionId') sessionId: string): Observable<MessageEvent> {
    return this.sources.checkoutSessionStream(sessionId);
  }
}
