import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CacheSettingsService } from './cache-settings.service';
import { ClearCacheDto } from './dto/clear-cache.dto';
import { UpdateCacheSettingsDto } from './dto/update-cache-settings.dto';

@ApiTags('cache-settings')
@ApiBearerAuth('bearer')
@UseGuards(JwtGuard)
@Controller('platform/cache-settings')
export class CacheSettingsController {
  constructor(private readonly _service: CacheSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiOperation({ summary: 'Paramètres cache Redis (admin.settings)' })
  getSettings(@Req() req: Request) {
    return this._service.getSettings(req.user as UserModel);
  }

  @Put()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Met à jour les TTL cache (admin.settings)' })
  updateSettings(@Req() req: Request, @Body() body: UpdateCacheSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }

  @Post('clear')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Vide le cache catalogue public (admin.settings)',
  })
  clearCache(@Req() req: Request, @Body() body: ClearCacheDto) {
    return this._service.clearCache(req.user as UserModel, body.scope);
  }
}
