import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AdminBusinessReportsQueryDto } from './dto/admin-business-reports-query.dto';
import { UpdateBusinessReportAdminDto } from './dto/update-business-report-admin.dto';
import { BusinessReportsService } from './business-reports.service';

@ApiTags('business-reports')
@ApiBearerAuth('bearer')
@Controller('business-reports')
export class BusinessReportsAdminController {
  @Inject(BusinessReportsService)
  private readonly _businessReports: BusinessReportsService;

  @Get('admin/by-store')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Liste des signalements boutiques groupés par restaurant (compte ADMIN uniquement)',
  })
  async listGroupedByStore(@Req() req: Request) {
    return this._businessReports.listGroupedByStoreForAdmin(
      req.user as UserModel,
    );
  }

  @Get('admin')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Liste paginée des signalements (filtres boutique / archivé) — ADMIN',
  })
  async listAdmin(
    @Req() req: Request,
    @Query() query: AdminBusinessReportsQueryDto,
  ) {
    return this._businessReports.listForAdmin(req.user as UserModel, query);
  }

  @Patch('admin/:id')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Mettre à jour gravité ou archivage d’un signalement — ADMIN',
  })
  async updateAdmin(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateBusinessReportAdminDto,
  ) {
    return this._businessReports.updateForAdmin(
      req.user as UserModel,
      id,
      body,
    );
  }
}
