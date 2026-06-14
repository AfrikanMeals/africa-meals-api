import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateSearchSettingsDto } from './dto/update-search-settings.dto';
import {
  SearchSettingsService,
  SearchVectorReindexService,
} from './search-settings.service';

@ApiTags('search-settings')
@Controller('platform/search-settings')
export class SearchSettingsController {
  constructor(
    private readonly _settings: SearchSettingsService,
    private readonly _reindex: SearchVectorReindexService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getPublic() {
    return this._settings.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateSearchSettingsDto) {
    return this._settings.updateSettings(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Post('reindex')
  @UseGuards(JwtGuard)
  triggerReindex(@Req() req: Request) {
    const user = req.user as UserModel;
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    return this._reindex.runReindex({ forceEmbeddings: true });
  }

  @ApiBearerAuth('bearer')
  @Get('reindex/status')
  @UseGuards(JwtGuard)
  reindexStatus() {
    return {
      running: this._reindex.isRunning(),
    };
  }
}
