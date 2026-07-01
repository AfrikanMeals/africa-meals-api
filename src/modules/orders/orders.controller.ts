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
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFieldSelection } from '@common/field-selection/api-field-selection.decorator';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BusinessReportsService } from '@modules/business-reports/business-reports.service';
import { resolveMongoIdFromPublicParam } from '@common/catalog-public-id.util';
import { CreateBusinessReportDto } from '@modules/business-reports/dto/create-business-report.dto';
import {
  ConfirmPickupDto,
  CreateRefundRequestDto,
  FilterOrdersDto,
  PatchPreOrderCustomerNoteDto,
  RejectOrderDto,
  VendorCourierLocationDto,
} from './dto/orders.dto';
import {
  CLIENT_ORDER_CANCEL_REASON_CODES,
  VENDOR_ORDER_CANCEL_REASON_CODES,
} from './order-cancel-reasons';
import { OrderStatusEventsService } from './order-status-events.service';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth('bearer')
@Controller('orders')
export class OrdersController {
  @Inject(OrdersService)
  private readonly _ordersService: OrdersService;

  @Inject(BusinessReportsService)
  private readonly _businessReports: BusinessReportsService;

  @Inject(OrderStatusEventsService)
  private readonly _orderStatusEvents: OrderStatusEventsService;

  /** Historique des changements de statut (admin). */
  @Get('admin/status-history')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Journal des statuts de commande (ADMIN)' })
  async adminStatusHistory(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('orderId') orderId?: string,
  ) {
    const lim = limit != null ? Number(limit) : undefined;
    const sk = skip != null ? Number(skip) : undefined;
    return this._orderStatusEvents.listForAdmin(req.user as UserModel, {
      limit: Number.isFinite(lim) ? lim : undefined,
      skip: Number.isFinite(sk) ? sk : undefined,
      orderId: orderId?.trim() || undefined,
    });
  }

  /** Motifs d’annulation / refus (codes pour listes déroulantes). */
  @Get('cancel-reasons')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Codes motifs annulation commande (vendeur / client)',
  })
  listCancelReasons() {
    return {
      vendor: [...VENDOR_ORDER_CANCEL_REASON_CODES],
      client: [...CLIENT_ORDER_CANCEL_REASON_CODES],
    };
  }

  /** Liste des commandes — doit être déclaré avant les routes `/:id`. */
  @Get()
  @ApiFieldSelection()
  @UseGuards(JwtGuard)
  async filter(
    @Req() req: Request,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    args: FilterOrdersDto,
  ) {
    return this._ordersService.filter(args, req.user as UserModel);
  }

  @Get(':id/shipping-price')
  @UseGuards(JwtGuard)
  async calculateShippingPrice(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.calculateShippingPrice(
      id,
      req.user as UserModel,
    );
  }

  /** Signalement boutique (client propriétaire de la commande). */
  @Post(':id/report-business')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Signaler une boutique (lié à la commande)' })
  async reportBusiness(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateBusinessReportDto,
  ) {
    return this._businessReports.createForOrder(
      req.user as UserModel,
      id,
      body,
    );
  }

  /** Prise en charge vendeur — client notifié, statut reste `paied`. */
  @Post(':id/accept')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Prendre en charge la commande (VENDOR / ADMIN)' })
  async acceptOrder(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.acceptOrder(id, req.user as UserModel);
  }

  /** Prête pour livraison ou retrait (`approved`) + notification client. */
  @Post(':id/mark-ready')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Marquer la commande prête (VENDOR / ADMIN)' })
  async markReady(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.markOrderReady(id, req.user as UserModel);
  }

  /** Vendeur : s’assigne la livraison puis passe la commande en `shipped`. */
  @Post(':id/assign-self-delivery')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'S’assigner la livraison (VENDOR)' })
  async assignSelfDelivery(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.assignVendorSelfDelivery(
      id,
      req.user as UserModel,
    );
  }

  /** Vendeur assigné : position GPS pour suivi temps réel. */
  @Post(':id/vendor-courier-location')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Position livreur vendeur (VENDOR assigné)' })
  async reportVendorCourierLocation(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: VendorCourierLocationDto,
  ) {
    return this._ordersService.reportVendorSelfDeliveryLocation(
      id,
      req.user as UserModel,
      body.latitude,
      body.longitude,
    );
  }

  /** Renvoie le reçu / facture PDF par e-mail au client. */
  @Post(':id/send-receipt-email')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Envoyer le reçu client par e-mail (VENDOR / ADMIN)',
  })
  async sendReceiptEmail(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.sendClientReceiptEmail(
      id,
      req.user as UserModel,
    );
  }

  /** Refus / annulation par vendeur ou admin avec motif. */
  @Post(':id/reject')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Refuser / annuler la commande (VENDOR / ADMIN)' })
  async rejectOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: RejectOrderDto,
  ) {
    return this._ordersService.rejectOrder(id, req.user as UserModel, body);
  }

  /** Client : génère un nouveau code retrait (commande retrait active). */
  @Post(':id/pickup-code')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Générer un nouveau code retrait (CLIENT)' })
  async regeneratePickupCode(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.regeneratePickupCodeForClient(
      id,
      req.user as UserModel,
    );
  }

  /** Retrait : le vendeur / l’admin valide le code → commande livrée (`completed`). */
  @Post(':id/confirm-pickup')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Confirmer un retrait avec le code client (VENDOR / ADMIN)',
  })
  async confirmPickup(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: ConfirmPickupDto,
  ) {
    return this._ordersService.confirmPickupByCode(
      id,
      req.user as UserModel,
      body,
    );
  }

  /** Demande de remboursement (client propriétaire de la commande). */
  /** Client : note sur une pré-commande planifiée. */
  @Patch(':id/pre-order-note')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Mettre à jour la note client (pré-commande)' })
  async patchPreOrderNote(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchPreOrderCustomerNoteDto,
  ) {
    return this._ordersService.patchPreOrderCustomerNote(
      id,
      req.user as UserModel,
      body.customerNote,
    );
  }

  @Post(':id/refund-request')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Demander un remboursement (journal sur la commande)',
  })
  async requestRefund(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateRefundRequestDto,
  ) {
    return this._ordersService.submitRefundRequest(
      id,
      req.user as UserModel,
      body,
    );
  }

  @Get(':id/live-tracking')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Suivi temps réel commande (CLIENT)' })
  async liveTracking(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.getLiveTrackingForClient(
      id,
      req.user as UserModel,
    );
  }

  @Get(':id/public')
  @ApiOperation({
    summary: 'Résumé commande public (landing web / lien e-mail)',
  })
  async publicSummary(@Param('id') id: string) {
    const orderId = resolveMongoIdFromPublicParam(id) ?? id;
    return this._ordersService.getPublicOrderSummary(orderId);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async findOneById(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('asCustomer') asCustomer?: string,
  ) {
    const flag = String(asCustomer ?? '')
      .trim()
      .toLowerCase();
    return this._ordersService.findOneById(id, req.user as UserModel, {
      asCustomer:
        flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on',
    });
  }
}
