import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  @Inject(DashboardService)
  private readonly _dashboardService: DashboardService;

  @Get('alerts')
  @UseGuards(JwtGuard)
  alerts(@Req() req: Request) {
    return this._dashboardService.getAlerts(req.user as UserModel);
  }

  /** Indicateurs agrégés (ADMIN uniquement) — CA, commandes, inscriptions, délai livraison. */
  @Get('admin/kpis')
  @UseGuards(JwtGuard)
  adminKpis(@Req() req: Request) {
    return this._dashboardService.getAdminKpis(req.user as UserModel);
  }

  /** Avis sur les plats (notes produit), avec client, plat et restaurant — admin ou vendeur. */
  @Get('product-reviews')
  @UseGuards(JwtGuard)
  productReviews(@Req() req: Request) {
    return this._dashboardService.getProductReviewsDashboard(
      req.user as UserModel,
    );
  }
}
