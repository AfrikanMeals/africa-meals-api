import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PosSettingsService } from './pos-settings.service';

@ApiTags('platform')
@Controller('platform/pos')
export class PlatformPosController {
  @Inject(PosSettingsService)
  private readonly _pos: PosSettingsService;

  /** Catalogue public POS (liens de téléchargement + forfaits actifs). */
  @Get()
  @ApiOperation({ summary: 'Catalogue public Wise Eat POS' })
  getPublicCatalog() {
    return this._pos.getPublicCatalog();
  }
}
