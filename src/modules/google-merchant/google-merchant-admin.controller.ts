import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBasicAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request, Response } from 'express';
import {
  assertGoogleMerchantBasicAuth,
  checkGoogleMerchantBasicAuth,
} from './google-merchant-basic-auth.util';
import { GoogleMerchantService } from './google-merchant.service';

@ApiTags('google-merchant')
@Controller('google-merchant/admin')
export class GoogleMerchantAdminController {
  private readonly logger = new Logger(GoogleMerchantAdminController.name);

  constructor(
    private readonly _googleMerchant: GoogleMerchantService,
    private readonly _config: ConfigService,
  ) {}

  @Get('meta')
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Configuration flux Google Merchant (URL, Basic Auth, stats — admin marketing)',
  })
  getMeta(@Req() req: Request) {
    return this._googleMerchant.getAdminMeta(req.user as UserModel);
  }

  @Get('preview')
  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Télécharge le flux toutes boutiques (JWT admin — test sans Basic Auth)',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: ['csv', 'xlsx', 'xls', 'json', 'xml'],
  })
  async preview(
    @Req() req: Request,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const startedAt = Date.now();
    const user = req.user as UserModel;
    this.logger.log(
      `preview request userId=${String(user?._id ?? 'unknown')} format=${JSON.stringify(format)} ${this.describeRequest(req)}`,
    );

    try {
      const result = await this._googleMerchant.exportAllStoresFeedForAdmin(
        user,
        format,
      );
      res.setHeader('Content-Type', result.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.body);
      this.logger.log(
        `preview ok format=${JSON.stringify(format)} filename=${result.filename} contentType=${result.contentType} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      this.logger.error(
        `preview failed format=${JSON.stringify(format)} durationMs=${Date.now() - startedAt} ${this.describeRequest(req)} error=${this.describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @Get('export')
  @ApiBasicAuth('google-merchant-basic')
  @ApiOperation({
    summary:
      'Exporte le catalogue de toutes les boutiques actives (Google Merchant Center, HTTP Basic)',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: ['csv', 'xlsx', 'xls', 'json', 'xml'],
    description: 'Format de sortie du flux produits (xls est accepté comme alias xlsx)',
  })
  async exportAllStores(
    @Req() req: Request,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(
      `export request format=${JSON.stringify(format)} ${this.describeRequest(req)}`,
    );

    const authCheck = checkGoogleMerchantBasicAuth(req, this._config);
    if (authCheck.ok === false) {
      this.logger.warn(
        `export auth rejected reason=${authCheck.reason} status=${authCheck.status} format=${JSON.stringify(format)} ${this.describeRequest(req)}`,
      );
      assertGoogleMerchantBasicAuth(req, res, this._config);
      return;
    }

    try {
      const result = await this._googleMerchant.exportAllStoresFeed(format);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.body);
      this.logger.log(
        `export ok user=${authCheck.user} format=${JSON.stringify(format)} contentType=${result.contentType} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      this.logger.error(
        `export failed user=${authCheck.user} format=${JSON.stringify(format)} durationMs=${Date.now() - startedAt} ${this.describeRequest(req)} error=${this.describeError(error)}`,
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
    const hasAuthHeader = Boolean(req.headers.authorization);
    return `ip=${clientIp} userAgent=${JSON.stringify(userAgent)} hasAuthHeader=${hasAuthHeader}`;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error ?? 'unknown_error');
  }
}
