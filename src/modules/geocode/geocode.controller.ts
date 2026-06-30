import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  ForwardGeocodeQueryDto,
  isGeocodeQueryLongEnough,
  ReverseGeocodeQueryDto,
} from './dto/geocode.dto';
import { GeocodeService } from './geocode.service';

@ApiTags('geocode')
@ApiBearerAuth('bearer')
@Controller('geocode')
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  @Get('forward')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async forward(@Req() req: Request, @Query() query: ForwardGeocodeQueryDto) {
    if (!isGeocodeQueryLongEnough(query.q)) {
      return { features: [], cached: false, engine: 'osm' };
    }
    return this.geocode.forward(
      {
        query: query.q,
        countryCode: query.countryCode ?? '',
        limit: query.limit,
        proximityLng: query.proximityLng,
        proximityLat: query.proximityLat,
        context: query.context,
      },
      req.user as UserModel,
    );
  }

  @Get('reverse')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async reverse(@Req() req: Request, @Query() query: ReverseGeocodeQueryDto) {
    return this.geocode.reverse(
      {
        lat: query.lat,
        lng: query.lng,
        countryCode: query.countryCode ?? '',
        context: query.context,
      },
      req.user as UserModel,
    );
  }
}
