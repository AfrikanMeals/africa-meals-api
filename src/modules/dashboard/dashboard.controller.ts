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
import { AdminVendorFeedbacksQueryDto } from './dto/admin-vendor-feedbacks-query.dto';
import { AssignDashboardOrderDto } from './dto/assign-dashboard-order.dto';
import { CreateVendorFeedbackDto } from './dto/create-vendor-feedback.dto';
import { CreateVendorFeatureRequestDto } from './dto/create-vendor-feature-request.dto';
import { AdminVendorFeatureRequestsQueryDto } from './dto/admin-vendor-feature-requests-query.dto';
import { UpdateVendorFeatureRequestAdminDto } from './dto/update-vendor-feature-request-admin.dto';
import { AdminNewsletterSubscribersQueryDto } from './dto/admin-newsletter-subscribers-query.dto';
import { AdminSiteContactRequestsQueryDto } from './dto/admin-site-contact-requests-query.dto';
import { ReplySiteContactRequestDto } from './dto/reply-site-contact-request.dto';
import { CreateDashboardLivreurDto } from './dto/create-dashboard-livreur.dto';
import { UpdateDashboardLivreurStatutDto } from './dto/update-dashboard-livreur-statut.dto';
import { FinancePeriodReportQueryDto } from './dto/finance-period-report-query.dto';
import {
  DashboardRevenueSeriesQueryDto,
  parseRevenueSeriesPeriod,
} from './dto/revenue-series-query.dto';
import { CartSimulatorPreviewDto } from './dto/cart-simulator-preview.dto';
import { CartSimulatorService } from './cart-simulator.service';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  @Inject(DashboardService)
  private readonly _dashboardService: DashboardService;

  @Inject(CartSimulatorService)
  private readonly _cartSimulatorService: CartSimulatorService;

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

  /** Simulation panier checkout (articles, livraison, taxes, commission). */
  @Post('cart-simulator/preview')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  cartSimulatorPreview(
    @Req() req: Request,
    @Body() body: CartSimulatorPreviewDto,
  ) {
    return this._cartSimulatorService.preview(req.user as UserModel, body);
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

  /** Indicateurs agrégés (ADMIN uniquement) — alias de `daily-kpis`. */
  @Get('admin/kpis')
  @UseGuards(JwtGuard)
  adminKpis(@Req() req: Request) {
    return this._dashboardService.getAdminKpis(req.user as UserModel);
  }

  /** KPIs du jour — admin (plateforme) ou vendeur (ses boutiques). */
  @Get('daily-kpis')
  @UseGuards(JwtGuard)
  dailyKpis(@Req() req: Request) {
    return this._dashboardService.getDailyKpis(req.user as UserModel);
  }

  /** Courbe de revenus (7j / 30j / 12m) — admin ou vendeur. */
  @Get('revenue-series')
  @UseGuards(JwtGuard)
  revenueSeries(
    @Req() req: Request,
    @Query() query: DashboardRevenueSeriesQueryDto,
  ) {
    return this._dashboardService.getDashboardRevenueSeries(
      req.user as UserModel,
      parseRevenueSeriesPeriod(query.period),
    );
  }

  /** Derniers clients + nouveaux du jour — admin (plateforme) ou vendeur. */
  @Get('recent-customers')
  @UseGuards(JwtGuard)
  recentCustomers(@Req() req: Request) {
    return this._dashboardService.listRecentCustomers(req.user as UserModel);
  }

  /** Top boutiques par CA du jour — admin ou vendeur. */
  @Get('top-stores-today')
  @UseGuards(JwtGuard)
  topStoresToday(@Req() req: Request) {
    return this._dashboardService.listTopStoresToday(req.user as UserModel);
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

  /** Feedback produit du vendeur (qualité dashboard / expérience admin). */
  @Post('vendor-feedback')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  submitVendorFeedback(
    @Req() req: Request,
    @Body() body: CreateVendorFeedbackDto,
  ) {
    return this._dashboardService.submitVendorFeedback(
      req.user as UserModel,
      body,
    );
  }

  /** Consultation admin des feedbacks vendeurs (pagination + filtres date/note). */
  @Get('admin/vendor-feedbacks')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listVendorFeedbacks(
    @Req() req: Request,
    @Query() query: AdminVendorFeedbacksQueryDto,
  ) {
    return this._dashboardService.listVendorFeedbacksAdmin(
      req.user as UserModel,
      query,
    );
  }

  /** Demande de fonctionnalité depuis l’espace vendeur. */
  @Post('vendor-feature-requests')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  submitVendorFeatureRequest(
    @Req() req: Request,
    @Body() body: CreateVendorFeatureRequestDto,
  ) {
    return this._dashboardService.submitVendorFeatureRequest(
      req.user as UserModel,
      body,
    );
  }

  /** Liste admin des demandes de fonctionnalités vendeurs. */
  @Get('admin/vendor-feature-requests')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listVendorFeatureRequests(
    @Req() req: Request,
    @Query() query: AdminVendorFeatureRequestsQueryDto,
  ) {
    return this._dashboardService.listVendorFeatureRequestsAdmin(
      req.user as UserModel,
      query,
    );
  }

  /** Mise à jour du statut d’une demande vendeur (admin). */
  @Patch('admin/vendor-feature-requests/:id')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateVendorFeatureRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateVendorFeatureRequestAdminDto,
  ) {
    return this._dashboardService.updateVendorFeatureRequestAdmin(
      req.user as UserModel,
      id,
      body,
    );
  }

  /** Messages contact site vitrine (formulaire wise-eat.com/contact). */
  @Get('admin/site-contact-requests')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listSiteContactRequests(
    @Req() req: Request,
    @Query() query: AdminSiteContactRequestsQueryDto,
  ) {
    return this._dashboardService.listSiteContactRequestsAdmin(
      req.user as UserModel,
      query,
    );
  }

  /** Abonnés newsletter (inscriptions pied de page site vitrine). */
  @Get('admin/newsletter-subscribers')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listNewsletterSubscribers(
    @Req() req: Request,
    @Query() query: AdminNewsletterSubscribersQueryDto,
  ) {
    return this._dashboardService.listNewsletterSubscribersAdmin(
      req.user as UserModel,
      query,
    );
  }

  /** Réponse e-mail au client (template Wise Eat). */
  @Post('admin/site-contact-requests/:id/reply')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  replySiteContactRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ReplySiteContactRequestDto,
  ) {
    return this._dashboardService.replySiteContactRequestAdmin(
      req.user as UserModel,
      id,
      body,
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
  createLivreur(@Req() req: Request, @Body() body: CreateDashboardLivreurDto) {
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
