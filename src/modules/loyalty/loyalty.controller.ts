import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
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
}
