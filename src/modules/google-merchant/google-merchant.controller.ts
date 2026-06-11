import {
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GoogleMerchantService } from './google-merchant.service';

@ApiTags('google-merchant')
@Controller('google-merchant')
export class GoogleMerchantController {
  constructor(private readonly _googleMerchant: GoogleMerchantService) {}

  @Get('export')
  @ApiOperation({
    summary: 'Exporte le catalogue boutique au format Google Merchant Center',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: ['csv', 'xlsx', 'json', 'xml'],
    description: 'Format de sortie du flux produits',
  })
  @ApiQuery({
    name: 'store',
    required: true,
    description: 'Identifiant MongoDB de la boutique',
  })
  async exportFeed(
    @Query('format') format: string | undefined,
    @Query('store') store: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this._googleMerchant.exportStoreFeed(format, store);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.body);
  }
}
