import {
  AdBannerImageJsonDto,
  CreateAdManagementDto,
  PatchAdManagementDto,
} from '@modules/ads/dto/ad-management.dto';
import { ConfirmAdCreditCheckoutDto } from '@modules/ads/dto/confirm-ad-credit-checkout.dto';
import {
  CreateAdCampaignDto,
  PatchAdCampaignDto,
} from '@modules/ads/dto/ad-campaign.dto';
import { UpdateAdNotificationPricingDto } from '@modules/ads/dto/ad-notification.dto';
import { UpdateAdPricingDto } from '@modules/ads/dto/ad-pricing.dto';
import { TrackAdEventDto } from '@modules/ads/dto/ad-tracking.dto';
import { TrackAdCampaignEventDto } from '@modules/ads/dto/ad-campaign-tracking.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { slimAdForPublicClient } from '@utils/public-client-shapes';
import { AdsService } from './ads.service';

@ApiTags('ads')
@Controller('ads')
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  @Get('manage/:id/stats')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async adStats(@Param('id') id: string, @Req() req: Request) {
    return this.adsService.getAdStats(req.user as UserModel, id);
  }

  @Get('manage')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async listManage(@Req() req: Request) {
    return this.adsService.listForManagement(req.user as UserModel);
  }

  @Get('campaigns')
  @ApiOperation({
    summary: 'Liste publique des campagnes actives (fenêtre dates automatique)',
  })
  async listCampaignsPublic() {
    return this.adsService.listCampaignsPublic();
  }

  @Get('campaigns/manage')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async listCampaignsManage(@Req() req: Request) {
    return this.adsService.listCampaignsForManagement(req.user as UserModel);
  }

  /** Toutes les limites Ads de la boutique selon son plan d'abonnement. */
  @Get('campaigns/manage/item-limit')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "Limites Ads (items, bannières, campagnes) selon le plan d'abonnement." })
  async campaignItemLimit(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
  ) {
    const sid = storeId?.trim() ?? '';
    if (!sid) throw new BadRequestException('storeId_required');
    return this.adsService.resolveAdLimitsForManagementUser(
      req.user as UserModel,
      sid,
    );
  }

  @Get('campaigns/manage/archives')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async listCampaignsManageArchives(@Req() req: Request) {
    return this.adsService.listArchivedCampaignsForManagement(
      req.user as UserModel,
    );
  }

  @Post('campaigns/manage')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async createCampaignManage(
    @Req() req: Request,
    @Body() body: CreateAdCampaignDto,
  ) {
    return this.adsService.createCampaign(req.user as UserModel, body);
  }

  @Patch('campaigns/manage/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async patchCampaignManage(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: PatchAdCampaignDto,
  ) {
    return this.adsService.patchCampaign(req.user as UserModel, id, body);
  }

  @Delete('campaigns/manage/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async deleteCampaignManage(@Param('id') id: string, @Req() req: Request) {
    await this.adsService.removeCampaign(req.user as UserModel, id);
  }

  @Post('campaigns/manage/:id/end')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async endCampaignManage(@Param('id') id: string, @Req() req: Request) {
    return this.adsService.endCampaign(req.user as UserModel, id);
  }

  @Get('campaigns/manage/:id/stats')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async campaignStats(@Param('id') id: string, @Req() req: Request) {
    return this.adsService.getCampaignStats(req.user as UserModel, id);
  }

  @Post('campaigns/track')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  async trackCampaign(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: TrackAdCampaignEventDto,
  ) {
    return this.adsService.trackCampaignEvent(
      (req.user as UserModel | undefined) ?? null,
      body,
    );
  }

  @Get('my-credit')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Synthèse crédit Ads du vendeur (bannières + campagnes, basé performances).',
  })
  async myCredit(@Req() req: Request) {
    return this.adsService.getMyAdCredit(req.user as UserModel);
  }

  @Get('my-credit/payments')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Historique des paiements de crédit Ads du vendeur.',
  })
  async myCreditPayments(
    @Req() req: Request,
    @Query('limit') limitRaw?: string,
  ) {
    const parsed =
      limitRaw != null && limitRaw.trim() !== ''
        ? Number.parseInt(limitRaw, 10)
        : undefined;
    return this.adsService.listMyAdCreditPayments(req.user as UserModel, {
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
  }

  @Post('my-credit/checkout-session')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async createAdCreditCheckoutSession(@Req() req: Request) {
    return this.adsService.createAdCreditCheckoutSession(req.user as UserModel);
  }

  /** Compat legacy: certains clients appellent encore GET /checkout-session. */
  @Get('my-credit/checkout-session')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async createAdCreditCheckoutSessionGet(@Req() req: Request) {
    return this.adsService.createAdCreditCheckoutSession(req.user as UserModel);
  }

  /** Compat legacy: alias historique /checkout. */
  @Post('my-credit/checkout')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async createAdCreditCheckoutAlias(@Req() req: Request) {
    return this.adsService.createAdCreditCheckoutSession(req.user as UserModel);
  }

  /** Compat legacy: alias historique /checkout en GET. */
  @Get('my-credit/checkout')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async createAdCreditCheckoutAliasGet(@Req() req: Request) {
    return this.adsService.createAdCreditCheckoutSession(req.user as UserModel);
  }

  @Get('my-credit/checkout-health')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async adCreditCheckoutHealth(@Req() req: Request) {
    return this.adsService.getAdCreditCheckoutHealth(req.user as UserModel);
  }

  @Post('my-credit/confirm-checkout')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async confirmAdCreditCheckout(
    @Req() req: Request,
    @Body() body: ConfirmAdCreditCheckoutDto,
  ) {
    return this.adsService.confirmAdCreditCheckout(
      req.user as UserModel,
      body.sessionId,
    );
  }

  /**
   * Recalcule la facturation de toutes les bannières / campagnes archivées
   * sans `billingFinalizedAt`. Idempotent.
   * - Vendeur : ses boutiques uniquement.
   * - Admin : peut passer `?ownerId=<userId>` pour cibler un vendeur, ou rien pour tout.
   */
  @Post('my-credit/reconcile-billing')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Recalculer le crédit Ads (bannières/campagnes archivées).' })
  async reconcileAdCreditBilling(
    @Req() req: Request,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.adsService.reconcileAdCreditBilling(req.user as UserModel, {
      targetOwnerId: ownerId?.trim() || undefined,
    });
  }

  @Get('manage/pricing')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lire le barème Ads (ADMIN)' })
  async getManagePricing(@Req() req: Request) {
    return this.adsService.getPricing(req.user as UserModel);
  }

  @Put('manage/pricing')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour le barème Ads (ADMIN)' })
  async updateManagePricing(
    @Req() req: Request,
    @Body() body: UpdateAdPricingDto,
  ) {
    return this.adsService.updatePricing(req.user as UserModel, body);
  }

  @Get('manage/notification-pricing')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Barème notifications Ads (Email, Push, In-App, SMS) — livraison, interaction, conversion (ADMIN)',
  })
  async getManageNotificationPricing(@Req() req: Request) {
    return this.adsService.getNotificationPricing(req.user as UserModel);
  }

  @Put('manage/notification-pricing')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour le barème notifications Ads (ADMIN)' })
  async updateManageNotificationPricing(
    @Req() req: Request,
    @Body() body: UpdateAdNotificationPricingDto,
  ) {
    return this.adsService.updateNotificationPricing(
      req.user as UserModel,
      body,
    );
  }

  /** Image bannière → Firebase Storage (SDK Admin), dossier `marketing/ads`. */
  @Post('manage/image')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        const extOk = /\.(jpe?g|png|webp)$/i.test(file.originalname);
        const mimeOk = /^(image\/(jpeg|png|webp))$/i.test(file.mimetype);
        if (!extOk || !mimeOk) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadBannerImage(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.adsService.uploadBannerImage(req.user as UserModel, file);
  }

  /** JSON + base64 : recommandé derrière Firebase / CF (multipart « Unexpected end of form »). */
  @Post('manage/image-json')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async uploadBannerImageJson(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdBannerImageJsonDto,
  ) {
    return this.adsService.uploadBannerImageJson(req.user as UserModel, body);
  }

  @Post('manage')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async createManage(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateAdManagementDto,
  ) {
    return this.adsService.createManagement(req.user as UserModel, body);
  }

  @Patch('manage/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async patchManage(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchAdManagementDto,
  ) {
    return this.adsService.patchManagement(req.user as UserModel, id, body);
  }

  @Post('manage/:id/end')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async endManage(@Param('id') id: string, @Req() req: Request) {
    return this.adsService.endManagement(req.user as UserModel, id);
  }

  @Delete('manage/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async deleteManage(@Param('id') id: string, @Req() req: Request) {
    await this.adsService.removeManagement(req.user as UserModel, id);
  }

  /** Suivi mobile : impression ou clic (JWT optionnel pour rattacher l’utilisateur). */
  @Post('track')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  async track(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: TrackAdEventDto,
  ) {
    return this.adsService.trackEvent(req.user as UserModel | undefined, body);
  }

  /**
   * Bannières accueil : globales + pubs `store` dont la boutique est **ACTIVE**.
   * Champs `validFrom` / `validUntil` : une date `validUntil` passée exclut la pub (Atlas : repousser la date ou laisser vide).
   * Réponse : `storeId` / `storeName` / `storeProfileImageUrl` lorsque la pub est liée boutique.
   */
  @Get()
  @ApiOperation({ summary: 'Liste publique des bannières (GET /ads)' })
  async list() {
    const raw = await this.adsService.listPublic();
    const items = (raw as unknown as Record<string, unknown>[]).map((row) =>
      slimAdForPublicClient(row),
    );
    return { items };
  }
}
