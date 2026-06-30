import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateMapSettingsDto } from './dto/update-map-settings.dto';
import { MapSettingsService } from './map-settings.service';

@ApiTags('map-settings')
@Controller('platform/map-settings')
export class MapSettingsController {
  constructor(private readonly _service: MapSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getPublic(@Query('regionCode') regionCode?: string) {
    return this._service.getPublicSettings(regionCode);
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateMapSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
