import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Delete,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { QueryRequestStatsDto } from './dto/query-request-stats.dto';
import { RequestStatsService } from './request-stats.service';

@ApiTags('request-stats')
@ApiBearerAuth('bearer')
@Controller('request-stats')
export class RequestStatsAdminController {
  @Inject(RequestStatsService)
  private readonly requestStats: RequestStatsService;

  @Get('admin')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Journal des requêtes HTTP API (admin, permission admin.settings)',
  })
  async list(@Req() req: Request, @Query() query: QueryRequestStatsDto) {
    return this.requestStats.list(req.user as UserModel, query);
  }

  @Delete('admin')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Vide le tampon de stats HTTP en mémoire (admin)',
  })
  async clear(@Req() req: Request) {
    return this.requestStats.clear(req.user as UserModel);
  }
}
