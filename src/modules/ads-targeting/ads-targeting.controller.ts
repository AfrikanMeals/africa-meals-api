import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  AdsTargetingIngestDto,
  AdsTargetingRecommendQueryDto,
  CreateTargetingCampaignDto,
  PatchTargetingCampaignDto,
} from './dto/ads-targeting.dto';
import { AdsTargetingService } from './ads-targeting.service';

@ApiTags('ads-targeting')
@Controller('ads/targeting')
export class AdsTargetingController {
  constructor(private readonly svc: AdsTargetingService) {}

  @Post('events')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Ingestion batch événements ads targeting (non bloquante)',
  })
  ingest(@Req() req: Request, @Body() body: AdsTargetingIngestDto) {
    return this.svc.ingest((req.user as UserModel | undefined) ?? null, body);
  }

  @Get('users/:userId/profile')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Profil d’intérêt utilisateur agrégé' })
  profile(@Req() req: Request, @Param('userId') userId: string) {
    return this.svc.getUserProfile(req.user as UserModel, userId);
  }

  @Get('recommend')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Recommandation ads personnalisée' })
  recommend(
    @Req() req: Request,
    @Query() query: AdsTargetingRecommendQueryDto,
  ) {
    return this.svc.recommend((req.user as UserModel | undefined) ?? null, {
      userId: query.user_id,
      placement: query.placement,
      limit: query.limit,
    });
  }

  @Post('campaigns')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer une campagne ads avec ciblage' })
  createCampaign(
    @Req() req: Request,
    @Body() body: CreateTargetingCampaignDto,
  ) {
    return this.svc.createCampaign(req.user as UserModel, body);
  }

  @Get('campaigns')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les campagnes ads ciblées' })
  campaigns(@Req() req: Request) {
    return this.svc.listCampaigns(req.user as UserModel);
  }

  @Patch('campaigns/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour une campagne ciblée' })
  patchCampaign(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: PatchTargetingCampaignDto,
  ) {
    return this.svc.patchCampaign(req.user as UserModel, id, body);
  }

  @Delete('campaigns/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Archiver une campagne ciblée' })
  archiveCampaign(@Req() req: Request, @Param('id') id: string) {
    return this.svc.archiveCampaign(req.user as UserModel, id);
  }

  @Get('campaigns/:id/stats')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Stats campagne ciblée (CTR/imp/clic/conversion)' })
  campaignStats(@Req() req: Request, @Param('id') id: string) {
    return this.svc.campaignStats(req.user as UserModel, id);
  }

  @Delete('users/:id/data')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'GDPR: suppression des données ads targeting utilisateur',
  })
  eraseUserData(@Req() req: Request, @Param('id') id: string) {
    return this.svc.eraseUserData(req.user as UserModel, id);
  }

  @Get('dashboard/overview')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Vue dashboard targeting ads (admin)' })
  dashboardOverview(@Req() req: Request) {
    return this.svc.dashboardOverview(req.user as UserModel);
  }
}
