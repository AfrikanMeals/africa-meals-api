import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Put,
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
import { AppPoliciesService } from './app-policies.service';
import { UpsertAppPolicyDto } from './dto/upsert-app-policy.dto';
import { PolicySectionImageJsonDto } from './dto/policy-section-image.dto';
import { UpdatePlatformLegalSettingsDto } from './dto/update-platform-legal-settings.dto';
import { PlatformLegalSettingsService } from './platform-legal-settings.service';

@ApiTags('policies')
@Controller('policies')
export class AppPoliciesController {
  constructor(
    private readonly _policies: AppPoliciesService,
    private readonly _legalSettings: PlatformLegalSettingsService,
  ) {}

  @Get('public/config')
  @ApiOperation({
    summary:
      'Configuration légale publique (variables de template FR/EN)',
  })
  getPublicLegalConfig(@Query('locale') locale?: string) {
    return this._legalSettings.getPublicConfig(locale);
  }

  @Get('public')
  @ApiOperation({ summary: 'Lister les politiques publiées (site / app)' })
  listPublic(@Query('locale') locale?: string) {
    return this._policies.listPublishedPublic(locale);
  }

  @Get('public/:slug')
  @ApiOperation({ summary: 'Politique publiée (site / app)' })
  getPublic(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this._policies.getPublishedPublic(slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Get('admin')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les politiques (ADMIN)' })
  listAdmin(@Req() req: Request) {
    return this._policies.listForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Post('admin/section-image-json')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Image de section → Firebase Storage (ADMIN)' })
  uploadSectionImage(
    @Req() req: Request,
    @Body() body: PolicySectionImageJsonDto,
  ) {
    return this._policies.uploadSectionImage(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Put('admin')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour une politique (ADMIN)' })
  upsert(@Req() req: Request, @Body() body: UpsertAppPolicyDto) {
    return this._policies.upsert(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lire une politique pour édition (ADMIN)' })
  getAdmin(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._policies.getForAdmin(
      req.user as UserModel,
      slug,
      locale ?? 'fr',
    );
  }

  @ApiBearerAuth('bearer')
  @Get('admin/legal-config')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Configuration légale plateforme (ADMIN)' })
  getLegalConfigAdmin(@Req() req: Request) {
    return this._legalSettings.getForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/legal-config')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour la configuration légale (ADMIN)' })
  updateLegalConfigAdmin(
    @Req() req: Request,
    @Body() body: UpdatePlatformLegalSettingsDto,
  ) {
    return this._legalSettings.update(req.user as UserModel, body);
  }
}
