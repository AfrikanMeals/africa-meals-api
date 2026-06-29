import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateStockManagerSettingsDto } from './dto/update-stock-manager-settings.dto';
import { StockManagerSettingsService } from './stock-manager-settings.service';

@ApiTags('stock-manager-settings')
@Controller('platform/stock-manager-settings')
export class StockManagerSettingsController {
  constructor(private readonly _service: StockManagerSettingsService) {}

  /** Lecture publique — affichage menu admin + garde API stock. */
  @Get()
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateStockManagerSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
