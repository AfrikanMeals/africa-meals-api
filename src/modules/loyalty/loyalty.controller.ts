import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty')
@ApiBearerAuth('bearer')
@Controller('loyalty')
export class LoyaltyController {
  @Inject(LoyaltyService)
  private readonly _loyaltyService: LoyaltyService;

  /**
   * Tableau de bord fidélité (membres éligibles + stats).
   * Admin : tous les acheteurs éligibles ; vendeur : clients ayant commandé chez lui.
   */
  @Get('dashboard')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Fidélité — membres, niveaux et statistiques' })
  async getDashboard(@Req() req: Request) {
    return this._loyaltyService.getDashboard(req.user as UserModel);
  }

  @Get('settings')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Configuration fidélité (ADMIN)' })
  async getSettings(@Req() req: Request) {
    return this._loyaltyService.getSettings(req.user as UserModel);
  }

  @Put('settings')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour la configuration fidélité (ADMIN)' })
  async updateSettings(
    @Req() req: Request,
    @Body() body: UpdateLoyaltySettingsDto,
  ) {
    return this._loyaltyService.updateSettings(req.user as UserModel, body);
  }
}
