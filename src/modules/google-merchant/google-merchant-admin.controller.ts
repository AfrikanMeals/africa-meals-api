import {
  Controller,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBasicAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { assertGoogleMerchantBasicAuth } from './google-merchant-basic-auth.util';
import { GoogleMerchantService } from './google-merchant.service';

@ApiTags('google-merchant')
@ApiBasicAuth('google-merchant-basic')
@Controller('google-merchant/admin')
export class GoogleMerchantAdminController {
  constructor(
    private readonly _googleMerchant: GoogleMerchantService,
    private readonly _config: ConfigService,
  ) {}

  @Get('export')
  @ApiOperation({
    summary:
      'Exporte le catalogue de toutes les boutiques actives (Google Merchant Center, HTTP Basic)',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: ['csv', 'xlsx', 'json', 'xml'],
    description: 'Format de sortie du flux produits',
  })
  async exportAllStores(
    @Req() req: Request,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!assertGoogleMerchantBasicAuth(req, res, this._config)) {
      return;
    }

    const result = await this._googleMerchant.exportAllStoresFeed(format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.body);
  }
}
