import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { NestHttpResponse } from '@common/http/http-response.util';
import { Request } from 'express';
import { sendGoogleMerchantExport } from './google-merchant-http.util';
import { GoogleMerchantService } from './google-merchant.service';

@ApiTags('google-merchant')
@Controller('google-merchant')
export class GoogleMerchantController {
  private readonly logger = new Logger(GoogleMerchantController.name);

  constructor(private readonly _googleMerchant: GoogleMerchantService) {}

  @Get('export')
  @ApiOperation({
    summary: 'Exporte le catalogue boutique au format Google Merchant Center',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: ['txt', 'tsv', 'csv', 'xlsx', 'xls', 'json', 'xml'],
    description:
      'Format du flux (txt/tsv recommandé GMC ; xls renvoie du texte tabulé car Excel n’est pas accepté par Google)',
  })
  @ApiQuery({
    name: 'store',
    required: true,
    description: 'Identifiant MongoDB de la boutique',
  })
  async exportFeed(
    @Req() req: Request,
    @Query('format') format: string | undefined,
    @Query('store') store: string | undefined,
    @Res() res: NestHttpResponse,
  ): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(
      `store export request store=${JSON.stringify(store)} format=${JSON.stringify(format)} ${this.describeRequest(req)}`,
    );

    try {
      const result = await this._googleMerchant.exportStoreFeed(format, store);
      // FastifyReply n’a pas setHeader Express — pièce jointe via helper GMC.
      sendGoogleMerchantExport(res, result, { asAttachment: true });
      this.logger.log(
        `store export ok store=${JSON.stringify(store)} format=${JSON.stringify(format)} filename=${result.filename} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      this.logger.error(
        `store export failed store=${JSON.stringify(store)} format=${JSON.stringify(format)} durationMs=${Date.now() - startedAt} ${this.describeRequest(req)} error=${this.describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private describeRequest(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim() || req.ip
        : req.ip;
    const userAgent = String(req.headers['user-agent'] ?? 'unknown');
    return `ip=${clientIp} userAgent=${JSON.stringify(userAgent)}`;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error ?? 'unknown_error');
  }
}
