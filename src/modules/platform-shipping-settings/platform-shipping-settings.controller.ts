import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdatePlatformShippingSettingsDto } from './dto/platform-shipping-settings.dto';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';
import { PlatformShippingQuoteService } from './platform-shipping-quote.service';
import { PlatformShippingSettingsService } from './platform-shipping-settings.service';

@ApiTags('platform-shipping')
@Controller('platform/shipping-settings')
export class PlatformShippingSettingsController {
  constructor(
    private readonly _platformShipping: PlatformShippingSettingsService,
    private readonly _shippingQuote: PlatformShippingQuoteService,
  ) {}

  /** Lecture publique (apps mobile / devis livraison). */
  @Get()
  getSettings(@Query('regionCode') regionCode?: string) {
    return this._platformShipping.getPublicSettings(regionCode);
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateSettings(
    @Req() req: Request,
    @Body() body: UpdatePlatformShippingSettingsDto,
  ) {
    return this._platformShipping.updateSettings(req.user as UserModel, body);
  }

  /**
   * Cotation livraison plateforme : distance routière boutique ↔ adresse
   * (Google Distance Matrix prioritaire, Haversine en repli), puis barème.
   */
  @ApiBearerAuth('bearer')
  @Post('quote')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  quoteShipping(@Req() req: Request, @Body() body: ShippingQuoteDto) {
    return this._shippingQuote.quoteForUser(req.user as UserModel, body);
  }
}
