import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { CronJobRunnerService } from '@modules/cron-monitor/cron-job-runner.service';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { UpdateCronJobStateDto } from '@modules/cron-monitor/dto/update-cron-job-state.dto';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';

@ApiTags('Admin — Cron jobs')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('db-maintenance/admin/cron-jobs')
export class CronMonitorAdminController {
  constructor(
    private readonly cronMonitor: CronMonitorService,
    private readonly cronRunner: CronJobRunnerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liste des crons planifiés et leur statut (admin.settings)' })
  list(@Req() req: Request) {
    return this.cronMonitor.listJobsForAdmin(req.user as UserModel);
  }

  @Patch(':key')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Met en pause ou reprend un cron (admin.settings)' })
  update(
    @Req() req: Request,
    @Param('key') key: string,
    @Body() dto: UpdateCronJobStateDto,
  ) {
    return this.cronMonitor.setJobPaused(
      req.user as UserModel,
      key,
      dto.paused,
    );
  }

  @Post(':key/run')
  @ApiOperation({
    summary: 'Exécute un cron manuellement (admin.settings, ignore pause / .env)',
  })
  run(@Req() req: Request, @Param('key') key: string) {
    return this.cronRunner.runJob(req.user as UserModel, key);
  }
}
