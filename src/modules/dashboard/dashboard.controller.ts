import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CreateDashboardLivreurDto } from './dto/create-dashboard-livreur.dto';
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
}
