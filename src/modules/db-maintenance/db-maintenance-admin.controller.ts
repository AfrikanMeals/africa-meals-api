import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { ClearDbTablesDto } from './dto/clear-db-tables.dto';
import { DbMaintenanceService } from './db-maintenance.service';

@ApiTags('db-maintenance')
@ApiBearerAuth('bearer')
@Controller('db-maintenance')
export class DbMaintenanceAdminController {
  @Inject(DbMaintenanceService)
  private readonly _dbMaintenance: DbMaintenanceService;

  @Get('admin/tables')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Liste les collections MongoDB vidables (admin, permission admin.settings)',
  })
  async listTables(@Req() req: Request) {
    return this._dbMaintenance.listTables(req.user as UserModel);
  }

  @Post('admin/clear')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Supprime tous les documents des collections sélectionnées (irréversible)',
  })
  async clearTables(@Req() req: Request, @Body() dto: ClearDbTablesDto) {
    return this._dbMaintenance.clearTables(
      req.user as UserModel,
      dto.tables,
    );
  }
}
