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
import { FilterOrdersDto } from './dto/orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth('bearer')
@Controller('orders')
export class OrdersController {
  @Inject(OrdersService)
  private readonly _ordersService: OrdersService;

  @Inject(BusinessReportsService)
  private readonly _businessReports: BusinessReportsService;

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

  @Get(':id')
  @UseGuards(JwtGuard)
  async findOneById(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.findOneById(id, req.user as UserModel);
  }
}
