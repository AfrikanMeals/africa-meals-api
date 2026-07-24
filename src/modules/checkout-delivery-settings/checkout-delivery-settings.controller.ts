import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateCheckoutDeliverySettingsDto } from './dto/update-checkout-delivery-settings.dto';
import { CheckoutDeliverySettingsService } from './checkout-delivery-settings.service';

@ApiTags('checkout-delivery-settings')
@Controller('platform/checkout-delivery-settings')
export class CheckoutDeliverySettingsController {
  constructor(private readonly _service: CheckoutDeliverySettingsService) {}

  /** Lecture publique — checkout mobile + panel admin. */
  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({
    summary:
      'Paramètres checkout livraison (masquage si aucun coursier) — lecture publique',
  })
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Met à jour les paramètres checkout livraison (admin uniquement)',
  })
  update(
    @Req() req: Request,
    @Body() body: UpdateCheckoutDeliverySettingsDto,
  ) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
