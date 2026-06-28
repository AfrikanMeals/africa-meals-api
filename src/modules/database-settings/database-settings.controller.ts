import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { DatabaseSettingsService } from './database-settings.service';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { TriggerBackupDto } from './dto/trigger-backup.dto';
import { TriggerMigrationDto } from './dto/trigger-migration.dto';
import { UpdateDatabaseSettingsDto } from './dto/update-database-settings.dto';
import { TestDatabaseConnectionDto } from './dto/test-database-connection.dto';

@ApiTags('database-settings')
@ApiBearerAuth('bearer')
@UseGuards(JwtGuard)
@Controller('platform/database-settings')
export class DatabaseSettingsController {
  constructor(private readonly service: DatabaseSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiOperation({
    summary: 'Planification sauvegardes / migration (admin.settings)',
  })
  getSettings(@Req() req: Request) {
    return this.service.getSettings(req.user as UserModel);
  }

  @Post('test-connection')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Teste la connexion MongoDB (base actuelle ou cible optionnelle, admin.settings)',
  })
  testConnection(@Req() req: Request, @Body() body: TestDatabaseConnectionDto) {
    return this.service.testConnection(req.user as UserModel, body);
  }

  @Put()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Met à jour la planification des sauvegardes (admin.settings)',
  })
  updateSettings(@Req() req: Request, @Body() body: UpdateDatabaseSettingsDto) {
    return this.service.updateSettings(req.user as UserModel, body);
  }

  @Get('backup-history')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiOperation({
    summary: 'Historique sauvegardes / migrations / restaurations',
  })
  listBackupHistory(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number(limit) : 50;
    return this.service.listBackupHistory(req.user as UserModel, parsed);
  }

  @Get('jobs/:jobId/progress')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiOperation({
    summary: 'Progression job sauvegarde / migration (fallback polling)',
  })
  getJobProgress(@Req() req: Request, @Param('jobId') jobId: string) {
    return this.service.getJobProgress(req.user as UserModel, jobId);
  }

  @Post('backup')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Déclenche une sauvegarde incrémentale ou complète (job async)',
  })
  triggerBackup(@Req() req: Request, @Body() body: TriggerBackupDto) {
    return this.service.triggerBackupAsync(req.user as UserModel, body);
  }

  @Post('migrate')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Copie la base actuelle vers une autre base MongoDB (job async)',
  })
  triggerMigration(@Req() req: Request, @Body() body: TriggerMigrationDto) {
    return this.service.triggerMigrationAsync(req.user as UserModel, body);
  }

  @Post('restore')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Restaure une sauvegarde depuis l’historique (job async)',
  })
  triggerRestore(@Req() req: Request, @Body() body: RestoreBackupDto) {
    return this.service.triggerRestoreAsync(req.user as UserModel, body);
  }
}
