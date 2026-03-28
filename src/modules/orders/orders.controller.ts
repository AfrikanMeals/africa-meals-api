import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { FilterOrdersDto } from './dto/orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth('bearer')
@Controller('orders')
export class OrdersController {
  @Inject(OrdersService)
  private readonly _ordersService: OrdersService;

  /** Liste des commandes — doit être déclaré avant les routes `/:id`. */
  @Get()
  @UseGuards(JwtGuard)
  async filter(@Req() req: Request, @Query() args: FilterOrdersDto) {
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

  @Get(':id')
  @UseGuards(JwtGuard)
  async findOneById(@Req() req: Request, @Param('id') id: string) {
    return this._ordersService.findOneById(id, req.user as UserModel);
  }
}
