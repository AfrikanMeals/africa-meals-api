import {
  CreateAdManagementDto,
  PatchAdManagementDto,
} from '@modules/ads/dto/ad-management.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AdsService } from './ads.service';

@ApiTags('ads')
@Controller('ads')
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  @Get('manage')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async listManage(@Req() req: Request) {
    return this.adsService.listForManagement(req.user as UserModel);
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

  @Delete('manage/:id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  async deleteManage(@Param('id') id: string, @Req() req: Request) {
    await this.adsService.removeManagement(req.user as UserModel, id);
  }

  /** Bannières globales (sans boutique), pour l’accueil public. */
  @Get()
  async list() {
    const items = await this.adsService.listPublic();
    return { items };
  }
}
