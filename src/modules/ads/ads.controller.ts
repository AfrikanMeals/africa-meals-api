import {
  AdBannerImageJsonDto,
  CreateAdManagementDto,
  PatchAdManagementDto,
} from '@modules/ads/dto/ad-management.dto';
import { TrackAdEventDto } from '@modules/ads/dto/ad-tracking.dto';
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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
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

  /** Bannières globales (sans boutique), pour l’accueil public. */
  @Get()
  async list() {
    const items = await this.adsService.listPublic();
    return { items };
  }
}
