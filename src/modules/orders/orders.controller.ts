import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BusinessReportsService } from '@modules/business-reports/business-reports.service';
import { CreateBusinessReportDto } from '@modules/business-reports/dto/create-business-report.dto';
import {
  ConfirmPickupDto,
  CreateRefundRequestDto,
  FilterOrdersDto,
  RejectOrderDto,
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

  /** Prête pour livraison ou retrait (`approved`) + notification client. */
  @Post(':id/mark-ready')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Marquer la commande prête (VENDOR / ADMIN)' })
  async markReady(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.markOrderReady(id, req.user as UserModel);
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
