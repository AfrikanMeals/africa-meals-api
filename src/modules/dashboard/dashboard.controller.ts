import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AssignDashboardOrderDto } from './dto/assign-dashboard-order.dto';
import { CreateDashboardLivreurDto } from './dto/create-dashboard-livreur.dto';
import { UpdateDashboardLivreurStatutDto } from './dto/update-dashboard-livreur-statut.dto';
import { FinancePeriodReportQueryDto } from './dto/finance-period-report-query.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  @Inject(DashboardService)
  private readonly _dashboardService: DashboardService;

  @Get('alerts')
  @UseGuards(JwtGuard)
  alerts(@Req() req: Request) {
    return this._dashboardService.getAlerts(req.user as UserModel);
  }

  /** Répartition des commandes (totaux + statuts) selon le rôle connecté. */
  @Get('order-status-summary')
  @UseGuards(JwtGuard)
  orderStatusSummary(@Req() req: Request) {
    return this._dashboardService.getDashboardOrderStatusSummary(
      req.user as UserModel,
    );
  }

  /** CA mois en cours + tendance vs période comparable mois précédent — admin ou vendeur. */
  @Get('revenue-summary')
  @UseGuards(JwtGuard)
  revenueSummary(@Req() req: Request) {
    return this._dashboardService.getDashboardRevenueSummary(
      req.user as UserModel,
    );
  }

  /** Top plats (commandes + notes) — vendeur uniquement. */
  @Get('vendor/top-plats')
  @UseGuards(JwtGuard)
  vendorTopPlats(@Req() req: Request) {
    return this._dashboardService.listVendorTopPlats(req.user as UserModel);
  }

  /** Top 5 plats (12 mois glissants) + tendance jour vs veille — vendeur ou admin. */
  @Get('top-plats-daily')
  @UseGuards(JwtGuard)
  topPlatsDaily(@Req() req: Request) {
    return this._dashboardService.listDashboardTopPlatsDaily(
      req.user as UserModel,
    );
  }

  /** Derniers clients + nouveaux du jour (1ère commande dans la boutique) — vendeur uniquement. */
  @Get('vendor/recent-customers')
  @UseGuards(JwtGuard)
  vendorRecentCustomers(@Req() req: Request) {
    return this._dashboardService.listVendorRecentCustomers(
      req.user as UserModel,
    );
  }

  /** Histogramme 24 h sur les 30 derniers jours glissants (America/Toronto) : commandes + livraisons (admin = toute la plateforme). */
  @Get('peak-hours')
  @UseGuards(JwtGuard)
  peakHours(@Req() req: Request) {
    return this._dashboardService.listPeakHoursActivity(req.user as UserModel);
  }

  /** Indicateurs agrégés (ADMIN uniquement) — CA, commandes, inscriptions, délai livraison. */
  @Get('admin/kpis')
  @UseGuards(JwtGuard)
  adminKpis(@Req() req: Request) {
    return this._dashboardService.getAdminKpis(req.user as UserModel);
  }

  /** Performance financière hebdomadaire par client / vendeur (Finances). */
  @Get('finance/weekly-user-performance')
  @UseGuards(JwtGuard)
  financeWeeklyUserPerformance(@Req() req: Request) {
    return this._dashboardService.getFinanceWeeklyUserPerformance(
      req.user as UserModel,
    );
  }

  /** Rapport CA + commandes sur une période (exports Finances). */
  @Get('finance/period-report')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  financePeriodReport(
    @Req() req: Request,
    @Query() query: FinancePeriodReportQueryDto,
  ) {
    return this._dashboardService.getFinancePeriodReport(
      req.user as UserModel,
      query.from,
      query.to,
    );
  }

  /** Avis sur les plats (notes produit), avec client, plat et restaurant — admin ou vendeur. */
  @Get('product-reviews')
  @UseGuards(JwtGuard)
  productReviews(@Req() req: Request) {
    return this._dashboardService.getProductReviewsDashboard(
      req.user as UserModel,
    );
  }

  /** Livreurs : liste par boutique (vendeur = ses boutiques, admin = tout). */
  @Get('livreurs')
  @UseGuards(JwtGuard)
  livreurs(@Req() req: Request) {
    return this._dashboardService.listDashboardLivreurs(req.user as UserModel);
  }

  /** Création livreur rattaché à une boutique (vendeur propriétaire ou admin avec `storeId`). */
  @Post('livreurs')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createLivreur(
    @Req() req: Request,
    @Body() body: CreateDashboardLivreurDto,
  ) {
    return this._dashboardService.createDashboardLivreur(
      req.user as UserModel,
      body,
    );
  }

  /** Assigne une commande en attente à un livreur disponible puis passe la commande en `shipped`. */
  @Post('livreurs/assign-order')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  assignOrderToLivreur(
    @Req() req: Request,
    @Body() body: AssignDashboardOrderDto,
  ) {
    return this._dashboardService.assignOrderToLivreur(
      req.user as UserModel,
      body,
    );
  }

  /** Met le livreur hors ligne (suspend) ou le repasse disponible (réactivation). */
  @Patch('livreurs/:id/statut')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateLivreurStatut(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateDashboardLivreurStatutDto,
  ) {
    return this._dashboardService.updateDashboardLivreurStatut(
      req.user as UserModel,
      id,
      body.statut,
    );
  }
}
