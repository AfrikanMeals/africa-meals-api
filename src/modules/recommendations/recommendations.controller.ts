import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { TrackRecommendationDto } from './dto/track-recommendation.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly _svc: RecommendationsService) {}

  @Get('feed')
  @UseGuards(OptionalAuthGuard)
  async feed(
    @Req() req: Request,
    @Query('take') take?: string,
  ): Promise<{
    products: Record<string, unknown>[];
    stores: Record<string, unknown>[];
    drinks: Record<string, unknown>[];
  }> {
    return this._svc.getFeed(req.user as UserModel | undefined, take);
  }

  @Post('track')
  @HttpCode(204)
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  async track(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: TrackRecommendationDto,
  ): Promise<void> {
    await this._svc.track(req.user as UserModel, body);
  }
}
