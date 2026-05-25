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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { RejectDeliveryAgentApplicationDto } from './dto/admin-review-delivery-agent.dto';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';
import { DeliveryAgentLocationDto } from './dto/delivery-agent-location.dto';
import { DeliveryAgentService } from './delivery-agent.service';

@ApiTags('delivery-agent')
@ApiBearerAuth('bearer')
@Controller('delivery-agent')
export class DeliveryAgentController {
  @Inject(DeliveryAgentService)
  private readonly _deliveryAgent: DeliveryAgentService;

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
      'Commande livraison en cours assignée au livreur connecté (statut expédié).',
  })
  async getActiveOrder(@Req() req: Request) {
    return this._deliveryAgent.getActiveOrder(req.user as UserModel);
  }

  @Post('location')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Position GPS du livreur (carte + suivi client en temps réel).',
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
  assignSelfToOrder(
    @Req() req: Request,
    @Param('orderId') orderId: string,
  ) {
    return this._deliveryAgent.assignSelfToOrder(
      req.user as UserModel,
      orderId,
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
    summary: 'Aperçu net estimé avant demande de versement Stripe Connect (livreur).',
  })
  stripeConnectPayoutEstimate(@Req() req: Request) {
    return this._deliveryAgent.getPayoutEstimate(req.user as UserModel);
  }

  @Post('payments/request-payout')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Demander un versement du solde disponible vers le compte bancaire (livreur).',
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
      'Historique des gains livraison (frais livraison client, part livreur estimée).',
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
}
