import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  DismissVendorGuidesDto,
  UpdateVendorGuideSettingsDto,
  UpsertVendorGuideDto,
} from './dto/vendor-guide.dto';
import { VendorGuidesService } from './vendor-guides.service';

@ApiTags('vendor-guides')
@Controller('vendor-guides')
export class VendorGuidesController {
  constructor(private readonly _service: VendorGuidesService) {}

  @ApiBearerAuth('bearer')
  @Get('pending')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Guides onboarding en attente (propriétaire boutique uniquement)',
  })
  getPending(
    @Req() req: Request,
    @Query('locale') locale?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this._service.getPendingForVendor(req.user as UserModel, {
      locale,
      storeId,
    });
  }

  @ApiBearerAuth('bearer')
  @Post('dismiss')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Marquer des guides comme vus / ignorés' })
  dismiss(@Req() req: Request, @Body() body: DismissVendorGuidesDto) {
    return this._service.dismissForVendor(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/guides')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les guides (ADMIN)' })
  listAdmin(@Req() req: Request) {
    return this._service.listGuidesForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/settings')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Paramètres diffusion guides (ADMIN)' })
  getSettingsAdmin(@Req() req: Request) {
    return this._service.getSettingsForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/guides')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour un guide (ADMIN)' })
  upsertGuide(@Req() req: Request, @Body() body: UpsertVendorGuideDto) {
    return this._service.upsertGuide(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Patch('admin/settings')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour les paramètres diffusion (ADMIN)' })
  updateSettings(
    @Req() req: Request,
    @Body() body: UpdateVendorGuideSettingsDto,
  ) {
    return this._service.updateSettings(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Delete('admin/guides/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Supprimer un guide (ADMIN)' })
  deleteGuide(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._service.deleteGuide(req.user as UserModel, slug, locale);
  }
}
