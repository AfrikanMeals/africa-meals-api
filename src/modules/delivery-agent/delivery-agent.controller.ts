import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  PreviewCustomerAbsentDeliveryDto,
  SubmitCustomerAbsentDeliveryJsonDto,
} from '@modules/pending-delivery/dto/pending-delivery.dto';
import { PendingDeliveryService } from '@modules/pending-delivery/pending-delivery.service';
import {
  RejectDeliveryAgentApplicationDto,
  SuspendDeliveryAgentApplicationDto,
} from './dto/admin-review-delivery-agent.dto';
import { AdminProcessDeliveryAgentPaymentsDto } from './dto/admin-process-delivery-agent-payments.dto';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';
import { DeliveryAgentLocationDto } from './dto/delivery-agent-location.dto';
import { PatchDeliveryAgentPresenceDto } from './dto/patch-delivery-agent-presence.dto';
import { SyncDeliveryAgentDailyPerformanceDto } from './dto/sync-delivery-agent-daily-performance.dto';
import {
  ConfirmDeliveryHandoffDto,
  PreviewDeliveryHandoffDto,
} from './dto/confirm-delivery-handoff.dto';
import { DeliveryAgentService } from './delivery-agent.service';
import { DeliveryOrderOfferService } from '@modules/delivery-order-offer/delivery-order-offer.service';
import { SetPartnerBadgeDto } from '@common/partner-badges/dto/set-partner-badge.dto';
import { AssignStripeConnectDto } from '@modules/store/dto/assign-stripe-connect.dto';

@ApiTags('delivery-agent')
@ApiBearerAuth('bearer')
@Controller('delivery-agent')
export class DeliveryAgentController {
  @Inject(DeliveryAgentService)
  private readonly _deliveryAgent: DeliveryAgentService;

  @Inject(PendingDeliveryService)
  private readonly _pendingDelivery: PendingDeliveryService;

  @Inject(DeliveryOrderOfferService)
  private readonly _deliveryOffers: DeliveryOrderOfferService;

  @Get('application')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Fiche candidature livreur (création brouillon implicite). Query includeFields pour alléger la charge réseau.',
  })
  async getApplication(@Req() req: Request) {
    return this._deliveryAgent.getOrCreateMine(req.user as UserModel);
  }

  @Patch('application')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async patchApplication(
    @Req() req: Request,
    @Body() dto: PatchDeliveryAgentApplicationDto,
  ) {
    return this._deliveryAgent.patchMine(req.user as UserModel, dto);
  }

  @Post('application/submit')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Soumet la candidature pour validation.' })
  async submit(@Req() req: Request) {
    return this._deliveryAgent.submitMine(req.user as UserModel);
  }

  @Get('orders/pending')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Commandes livraison en attente d’assignation (payées / approuvées, non expédiées).',
  })
  async listPendingOrders(@Req() req: Request) {
    return this._deliveryAgent.listPendingOrders(req.user as UserModel);
  }

  @Get('orders/active')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Commandes livraison en cours assignées au livreur connecté (statut expédié).',
  })
  async getActiveOrder(@Req() req: Request) {
    return this._deliveryAgent.getActiveOrder(req.user as UserModel);
  }

  @Get('orders/history')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Historique livraisons assignées au livreur. Query status=pending|cancelled|approved, page, take.',
  })
  listDeliveryHistory(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('take') take?: string,
  ) {
    return this._deliveryAgent.listDeliveryHistory(req.user as UserModel, {
      status,
      page,
      take,
    });
  }

  @Get('presence')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Présence livreur : disponible, occupé (course en cours) ou hors ligne.',
  })
  getPresence(@Req() req: Request) {
    return this._deliveryAgent.getPresence(req.user as UserModel);
  }

  @Get('performance/daily')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Indicateurs journaliers livreur (snapshot Mongo 1×/jour ; pas d’agrégat à chaque appel).',
  })
  getDailyPerformance(@Req() req: Request) {
    return this._deliveryAgent.getDailyPerformanceStats(req.user as UserModel);
  }

  @Post('performance/daily/sync')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Sync quotidien mobile → Mongo (expéditions locales + distance ; note recalculée 1×).',
  })
  syncDailyPerformance(
    @Req() req: Request,
    @Body() body: SyncDeliveryAgentDailyPerformanceDto,
  ) {
    return this._deliveryAgent.syncDailyPerformanceStats(
      req.user as UserModel,
      body,
    );
  }

  @Patch('presence')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Basculer disponible / hors ligne (occupé est automatique si course assignée).',
  })
  setPresence(@Req() req: Request, @Body() body: PatchDeliveryAgentPresenceDto) {
    return this._deliveryAgent.setPresence(req.user as UserModel, body);
  }

  @Post('location')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary: 'Position GPS du livreur (carte + suivi client en temps réel).',
  })
  async reportLocation(
    @Req() req: Request,
    @Body() body: DeliveryAgentLocationDto,
  ) {
    return this._deliveryAgent.reportLocation(req.user as UserModel, body);
  }

  @Post('orders/:orderId/assign-self')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Le livreur connecté s’assigne une commande en attente (passe en expédiée).',
  })
  assignSelfToOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    return this._deliveryAgent.assignSelfToOrder(
      req.user as UserModel,
      orderId,
    );
  }

  @Get('orders/offers/pending')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Offre course flotte boutique en cours pour le livreur connecté.',
  })
  getPendingDeliveryOffer(@Req() req: Request) {
    return this._deliveryOffers.getPendingOfferForAgent(req.user as UserModel);
  }

  @Post('orders/:orderId/offers/:offerId/accept')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Accepte une offre course exclusive (auto-dispatch flotte boutique).',
  })
  acceptDeliveryOffer(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Param('offerId') offerId: string,
  ) {
    return this._deliveryOffers.acceptOffer(
      req.user as UserModel,
      orderId,
      offerId,
    );
  }

  @Post('orders/:orderId/offers/:offerId/reject')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Refuse une offre course exclusive (passe au livreur suivant).',
  })
  rejectDeliveryOffer(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Param('offerId') offerId: string,
  ) {
    return this._deliveryOffers.rejectOffer(
      req.user as UserModel,
      orderId,
      offerId,
    );
  }

  @Post('orders/:orderId/abandon')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Le livreur abandonne une course en cours (retrait assignation, notification vendeur, pas de gain).',
  })
  abandonOrderDelivery(@Req() req: Request, @Param('orderId') orderId: string) {
    return this._deliveryAgent.abandonOrderDelivery(
      req.user as UserModel,
      orderId,
    );
  }

  @Post('orders/preview-handoff-code')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Aperçu commande assignée correspondant au code retrait / livraison scanné.',
  })
  previewHandoffByCode(
    @Req() req: Request,
    @Body() body: PreviewDeliveryHandoffDto,
  ) {
    return this._deliveryAgent.previewHandoffByCode(
      req.user as UserModel,
      body.code,
      body.orderId,
    );
  }

  @Post('orders/:orderId/confirm-handoff')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Valide le code retrait / livraison pour une commande assignée au livreur.',
  })
  confirmHandoffByCode(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() body: ConfirmDeliveryHandoffDto,
  ) {
    return this._deliveryAgent.confirmHandoffByCode(
      req.user as UserModel,
      orderId,
      body.code,
    );
  }

  @Post('orders/:orderId/customer-absent/preview')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Aperçu distance livreur ↔ adresse pour livraison client absent.',
  })
  previewCustomerAbsent(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() body: PreviewCustomerAbsentDeliveryDto,
  ) {
    return this._pendingDelivery.previewCustomerAbsent({
      user: req.user as UserModel,
      orderId,
      courierLat: body.courierLat,
      courierLng: body.courierLng,
    });
  }

  /** JSON + base64 — Fastify ne gère pas multipart/form-data (415). */
  @Post('orders/:orderId/customer-absent/submit')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Soumet une livraison client absent (JSON + photos base64) avec position GPS.',
  })
  submitCustomerAbsent(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() body: SubmitCustomerAbsentDeliveryJsonDto,
  ) {
    return this._pendingDelivery.submitCustomerAbsentJson({
      user: req.user as UserModel,
      orderId,
      courierLat: body.courierLat,
      courierLng: body.courierLng,
      proofPhotos: body.proofPhotos,
    });
  }

  /** Alias explicite (même corps JSON que /submit). */
  @Post('orders/:orderId/customer-absent/submit-json')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Soumet une livraison client absent (JSON + photos base64) — alternative fiable au multipart.',
  })
  submitCustomerAbsentJson(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() body: SubmitCustomerAbsentDeliveryJsonDto,
  ) {
    return this._pendingDelivery.submitCustomerAbsentJson({
      user: req.user as UserModel,
      orderId,
      courierLat: body.courierLat,
      courierLng: body.courierLng,
      proofPhotos: body.proofPhotos,
    });
  }

  @Get('store-partners')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Restaurants partenaires où le livreur est assigné (flotte gérée par le restaurant) avec statistiques.',
  })
  listStorePartners(@Req() req: Request) {
    return this._deliveryAgent.listStorePartners(req.user as UserModel);
  }

  @Get('store-driver-invites/pending')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Invitations livreur en attente (restaurants).' })
  listStoreDriverInvites(@Req() req: Request) {
    return this._deliveryAgent.listPendingInvites(req.user as UserModel);
  }

  @Post('store-driver-invites/accept')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  acceptStoreDriverInvite(
    @Req() req: Request,
    @Body() body: { token: string },
  ) {
    return this._deliveryAgent.acceptStoreDriverInvite(
      req.user as UserModel,
      body.token,
    );
  }

  @Post('store-driver-invites/decline')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  declineStoreDriverInvite(
    @Req() req: Request,
    @Body() body: { token: string },
  ) {
    return this._deliveryAgent.declineStoreDriverInvite(
      req.user as UserModel,
      body.token,
    );
  }

  @Delete('store-partners/:membershipId')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Quitter un restaurant partenaire (flotte active). Notifie le livreur et le vendeur.',
  })
  leaveStorePartner(
    @Req() req: Request,
    @Param('membershipId') membershipId: string,
  ) {
    return this._deliveryAgent.leaveStorePartner(
      req.user as UserModel,
      membershipId,
    );
  }

  @Get('payments/connect-status')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Statut Stripe Connect du livreur.' })
  stripeConnectStatus(@Req() req: Request) {
    return this._deliveryAgent.getConnectStatus(req.user as UserModel);
  }

  @Post('payments/onboarding-link')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lien d’onboarding Stripe Connect (livreur).' })
  stripeOnboardingLink(@Req() req: Request) {
    return this._deliveryAgent.createOnboardingLink(req.user as UserModel);
  }

  @Get('payments/balance')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Solde disponible Stripe Connect (livreur).' })
  stripeConnectBalance(@Req() req: Request) {
    return this._deliveryAgent.getConnectBalance(req.user as UserModel);
  }

  @Get('payments/payout-estimate')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Aperçu net estimé avant demande de versement Stripe Connect (livreur).',
  })
  stripeConnectPayoutEstimate(@Req() req: Request) {
    return this._deliveryAgent.getPayoutEstimate(req.user as UserModel);
  }

  @Post('payments/request-payout')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Demander un versement du solde disponible vers le compte bancaire (livreur).',
  })
  stripeConnectRequestPayout(@Req() req: Request) {
    return this._deliveryAgent.requestPayout(req.user as UserModel);
  }

  @Get('payments/payouts')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Historique des versements Stripe (livreur).' })
  listPayouts(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('starting_after') startingAfter?: string,
  ) {
    const n = limit != null ? Number(limit) : 25;
    return this._deliveryAgent.listPayouts(
      req.user as UserModel,
      n,
      startingAfter,
    );
  }

  @Get('payments/shipping-earnings')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Historique des gains livraison (frais livraison + pourboire versé au livreur).',
  })
  listShippingEarnings(@Req() req: Request) {
    return this._deliveryAgent.listShippingPaymentHistory(
      req.user as UserModel,
    );
  }

  @Get('admin/applications')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — liste des candidatures livreur.' })
  async listApplicationsAdmin(
    @Req() req: Request,
    @Query('status') status?: string,
  ) {
    return this._deliveryAgent.listApplicationsAdmin(
      req.user as UserModel,
      status,
    );
  }

  @Post('admin/applications/:applicationId/approve')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — approuver une candidature livreur.' })
  async approveApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._deliveryAgent.approveApplicationAdmin(
      req.user as UserModel,
      applicationId,
    );
  }

  @Post('admin/applications/:applicationId/reject')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Admin — refuser une candidature livreur.' })
  async rejectApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: RejectDeliveryAgentApplicationDto,
  ) {
    return this._deliveryAgent.rejectApplicationAdmin(
      req.user as UserModel,
      applicationId,
      body.rejectionReason,
    );
  }

  @Post('admin/applications/:applicationId/suspend')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Admin — suspendre un compte livreur approuvé (repasse le compte en USER).',
  })
  async suspendApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: SuspendDeliveryAgentApplicationDto,
  ) {
    return this._deliveryAgent.suspendApplicationAdmin(
      req.user as UserModel,
      applicationId,
      body.suspensionReason,
    );
  }

  @Post('admin/applications/:applicationId/reactivate')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — réactiver un compte livreur suspendu (repasse le compte en DELIVERY).',
  })
  async reactivateApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._deliveryAgent.reactivateApplicationAdmin(
      req.user as UserModel,
      applicationId,
    );
  }

  @Patch('admin/applications/:applicationId/partner-badge')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Admin — attribuer un badge partenaire (Silver / Gold / Diamond) à un livreur approuvé.',
  })
  async setApplicationPartnerBadgeAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: SetPartnerBadgeDto,
  ) {
    return this._deliveryAgent.setApplicationPartnerBadgeForAdmin(
      req.user as UserModel,
      applicationId,
      body.badgeCode ?? null,
    );
  }

  @Post('admin/applications/:applicationId/assign-stripe-connect')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Admin — lie manuellement un compte Stripe Connect (acct_…) à un livreur approuvé.',
  })
  async assignDeliveryAgentStripeConnectAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: AssignStripeConnectDto,
  ) {
    return this._deliveryAgent.assignDeliveryAgentStripeConnectForAdmin(
      req.user as UserModel,
      applicationId,
      body.stripeAccountId,
    );
  }

  @Post('admin/applications/:applicationId/sync-stripe-connect')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — resynchronise le statut Stripe Connect d’un livreur approuvé.',
  })
  async syncDeliveryAgentStripeConnectAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._deliveryAgent.syncDeliveryAgentStripeConnectForAdmin(
      req.user as UserModel,
      applicationId,
    );
  }

  @Post('admin/applications/:applicationId/reset-stripe-connect')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — déconnecte Stripe Connect d’un livreur approuvé (nouvel onboarding requis).',
  })
  async resetDeliveryAgentStripeConnectAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._deliveryAgent.resetDeliveryAgentStripeConnectForAdmin(
      req.user as UserModel,
      applicationId,
    );
  }

  @Get('admin/applications/:applicationId/finance-overview')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — performance, gains récents et solde Stripe d’un livreur approuvé.',
  })
  async getApplicationFinanceOverviewAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._deliveryAgent.getApplicationFinanceOverviewForAdmin(
      req.user as UserModel,
      applicationId,
    );
  }

  @Post('admin/applications/:applicationId/process-payments')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — (re)transfer commandes sélectionnées et/ou payout forcé hors badge.',
  })
  async processPaymentsAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() dto: AdminProcessDeliveryAgentPaymentsDto,
  ) {
    return this._deliveryAgent.processPaymentsForAdmin(
      req.user as UserModel,
      applicationId,
      dto,
    );
  }

  @Get('admin/applications/:applicationId/stripe-transfers/:transferId')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — détail Stripe d’un transfer Connect livreur.',
  })
  async getStripeTransferDetailsAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Param('transferId') transferId: string,
  ) {
    return this._deliveryAgent.getStripeTransferDetailsForAdmin(
      req.user as UserModel,
      applicationId,
      transferId,
    );
  }
}
