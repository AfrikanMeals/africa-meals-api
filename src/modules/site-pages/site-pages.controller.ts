import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpsertSitePageDto } from './dto/upsert-site-page.dto';
import { SitePagesService } from './site-pages.service';

@ApiTags('site-pages')
@Controller('site-pages')
export class SitePagesController {
  constructor(private readonly _sitePages: SitePagesService) {}

  @Get('public/:slug')
  @ApiOperation({
    summary: 'Landing marketing publiée (site vitrine)',
  })
  getPublic(
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._sitePages.getPublishedPublic(slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Get('admin')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les pages site (ADMIN)' })
  listAdmin(@Req() req: Request) {
    return this._sitePages.listForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lire une page site pour édition (ADMIN)' })
  getAdmin(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._sitePages.getForAdmin(
      req.user as UserModel,
      slug,
      locale ?? 'fr',
    );
  }

  @ApiBearerAuth('bearer')
  @Put('admin/:slug')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour une page site (ADMIN)' })
  upsert(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Body() body: UpsertSitePageDto,
  ) {
    return this._sitePages.upsert(req.user as UserModel, slug, body);
  }
}
