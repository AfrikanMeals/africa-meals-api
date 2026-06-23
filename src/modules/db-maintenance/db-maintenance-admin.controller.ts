import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
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
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { ClearDbTablesDto } from './dto/clear-db-tables.dto';
import { UpdateInfraRuntimeSettingsDto } from './dto/update-infra-runtime-settings.dto';
import { AdminAlertEmailService } from './admin-alert-email.service';
import {
  AdminAlertAudienceQueryDto,
  SendAdminAlertEmailDto,
} from './dto/send-admin-alert-email.dto';
import { SendOrderEmailDebugDto } from './dto/send-order-email-debug.dto';
import { DbMaintenanceService } from './db-maintenance.service';

@ApiTags('db-maintenance')
@ApiBearerAuth('bearer')
@Controller('db-maintenance')
export class DbMaintenanceAdminController {
  @Inject(DbMaintenanceService)
  private readonly _dbMaintenance: DbMaintenanceService;

  @Inject(AdminAlertEmailService)
  private readonly _adminAlertEmail: AdminAlertEmailService;

  @Get('admin/tables')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Liste les collections MongoDB vidables (admin, permission admin.settings)',
  })
  async listTables(@Req() req: Request) {
    return this._dbMaintenance.listTables(req.user as UserModel);
  }

  @Post('admin/clear')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Supprime tous les documents des collections sélectionnées (irréversible)',
  })
  async clearTables(@Req() req: Request, @Body() dto: ClearDbTablesDto) {
    return this._dbMaintenance.clearTables(req.user as UserModel, dto.tables);
  }

  @Post('admin/clear-async')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Supprime les collections sélectionnées en arrière-plan (jobId + SSE progression)',
  })
  async clearTablesAsync(@Req() req: Request, @Body() dto: ClearDbTablesDto) {
    return this._dbMaintenance.clearTablesAsync(
      req.user as UserModel,
      dto.tables,
    );
  }

  @Get('admin/integrity-tests')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: "Liste des tests d'intégrité manuels disponibles (admin.settings)",
  })
  async listIntegrityTests(@Req() req: Request) {
    return this._dbMaintenance.listIntegrityTests(req.user as UserModel);
  }

  @Post('admin/integrity-tests/:key/run')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      "Exécute un test d'intégrité manuellement et retourne les métriques",
  })
  async runIntegrityTest(@Req() req: Request, @Param('key') key: string) {
    return this._dbMaintenance.runIntegrityTest(req.user as UserModel, key);
  }

  @Get('admin/system-health/checks')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Liste des checks System Health disponibles (admin.settings)',
  })
  async listSystemHealthChecks(@Req() req: Request) {
    return this._dbMaintenance.listSystemHealthChecks(req.user as UserModel);
  }

  @Post('admin/system-health/:key/run')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Exécute un check System Health manuellement',
  })
  async runSystemHealthCheck(@Req() req: Request, @Param('key') key: string) {
    return this._dbMaintenance.runSystemHealthCheck(req.user as UserModel, key);
  }

  @Get('admin/runtime-services')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Lit les flags runtime infra (Redis manager / MQ broker) pour le dashboard admin',
  })
  async getRuntimeServices(@Req() req: Request) {
    return this._dbMaintenance.getInfraRuntimeSettings(req.user as UserModel);
  }

  @Put('admin/runtime-services')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Met à jour les flags runtime infra (Redis manager / MQ broker) depuis le dashboard admin',
  })
  async updateRuntimeServices(
    @Req() req: Request,
    @Body() dto: UpdateInfraRuntimeSettingsDto,
  ) {
    return this._dbMaintenance.updateInfraRuntimeSettings(
      req.user as UserModel,
      dto,
    );
  }

  @Get('admin/runtime-services/mqtt-status')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Statut MQTT live API/WS (connected/reconnecting/error + dernier topic)',
  })
  async getMqttStatus(@Req() req: Request) {
    return this._dbMaintenance.getInfraMqttStatus(req.user as UserModel);
  }

  @Get('admin/runtime-services/cache-status')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Statut live multicache (Redis + Memcached) — ping / SET-GET test',
  })
  async getCacheStatus(@Req() req: Request) {
    return this._dbMaintenance.getInfraCacheLiveStatus(req.user as UserModel);
  }

  @Get('admin/system-exchange')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Cartographie plateformes & liens de communication (MQTT, SSE, Redis, DB, API, WS, clients)',
  })
  async getSystemExchange(@Req() req: Request) {
    return this._dbMaintenance.getSystemExchangeStatus(req.user as UserModel);
  }

  @Get('admin/alert-system/audience-count')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Nombre de destinataires e-mail pour une audience Alert System (admin.settings)',
  })
  async countAlertAudience(
    @Req() req: Request,
    @Query() query: AdminAlertAudienceQueryDto,
  ) {
    return this._adminAlertEmail.countAudience(req.user as UserModel, query);
  }

  @Post('admin/alert-system/send')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Envoie une alerte e-mail (HTML + template) via file BullMQ ou synchrone (admin.settings)',
  })
  async sendAlertEmails(
    @Req() req: Request,
    @Body() dto: SendAdminAlertEmailDto,
  ) {
    return this._adminAlertEmail.enqueueCampaign(req.user as UserModel, dto);
  }

  @Get('admin/email-debug/context')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Contexte Email Debug (SMTP, commandes récentes, liens Google) — admin.settings',
  })
  async getEmailDebugContext(@Req() req: Request) {
    return this._dbMaintenance.getEmailDebugContext(req.user as UserModel);
  }

  @Post('admin/email-debug/send')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Envoie un e-mail de commande de test (JSON-LD Order / ParcelDelivery) — admin.settings',
  })
  async sendOrderEmailDebug(
    @Req() req: Request,
    @Body() dto: SendOrderEmailDebugDto,
  ) {
    return this._dbMaintenance.sendOrderEmailDebug(
      req.user as UserModel,
      dto,
    );
  }
}
