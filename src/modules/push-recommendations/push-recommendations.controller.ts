import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { TrackPushRecommendationDto } from './dto/track-push-recommendation.dto';
import { PushRecommendationsTrackingService } from './push-recommendations-tracking.service';

@ApiTags('push-recommendations')
@ApiBearerAuth('bearer')
@Controller('recommendations/push')
export class PushRecommendationsController {
  constructor(private readonly tracking: PushRecommendationsTrackingService) {}

  @Post('track')
  @HttpCode(204)
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  track(@Req() req: Request, @Body() body: TrackPushRecommendationDto) {
    return this.tracking.trackUserEvent(req.user as UserModel, body);
  }
}
