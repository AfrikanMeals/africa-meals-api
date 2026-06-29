import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { StorageEngineProbeService } from '@modules/medias/storage-engine-probe.service';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';
import { StorageSettingsService } from './storage-settings.service';

@ApiTags('storage-settings')
@Controller('platform/storage-settings')
export class StorageSettingsController {
  constructor(
    private readonly _service: StorageSettingsService,
    private readonly _probe: StorageEngineProbeService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateStorageSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Post('engines/:engine/probe')
  @UseGuards(JwtGuard)
  probeEngine(@Req() req: Request, @Param('engine') engine: string) {
    return this._probe.runProbe(req.user as UserModel, engine);
  }
}
