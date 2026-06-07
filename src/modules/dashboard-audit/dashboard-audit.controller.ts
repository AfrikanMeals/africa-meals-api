import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { DashboardAuditService } from './dashboard-audit.service';
import {
  BatchDashboardAuditEventsDto,
  QueryDashboardAuditEventsDto,
} from './dto/dashboard-audit.dto';

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip;
}

@ApiTags('dashboard-audit')
@ApiBearerAuth('bearer')
@Controller('dashboard-audit')
@UseGuards(JwtGuard)
export class DashboardAuditController {
  constructor(private readonly audit: DashboardAuditService) {}

  @Post('events')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Enregistre un lot d’actions dashboard (admin-web)' })
  recordEvents(
    @Req() req: Request,
    @Body() body: BatchDashboardAuditEventsDto,
  ) {
    return this.audit.recordBatch(req.user as UserModel, body, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });
  }

  @Get('events')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Journal des actions dashboard (admin: tous ; vendeur: ses actions + boutique)',
  })
  listEvents(
    @Req() req: Request,
    @Query() query: QueryDashboardAuditEventsDto,
  ) {
    return this.audit.list(req.user as UserModel, query);
  }
}
