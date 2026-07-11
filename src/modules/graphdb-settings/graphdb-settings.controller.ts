import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateGraphdbSettingsDto } from './dto/update-graphdb-settings.dto';
import { GraphdbSettingsService } from './graphdb-settings.service';

@ApiTags('graphdb-settings')
@ApiBearerAuth('bearer')
@UseGuards(JwtGuard)
@Controller('platform/graphdb-settings')
export class GraphdbSettingsController {
  constructor(private readonly _service: GraphdbSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiOperation({
    summary:
      'Flags Neo4j / GraphDB runtime (admin.settings) — NEO4J_ENABLED, RECO_GRAPH, GRAPH_SYNC',
  })
  getSettings(@Req() req: Request) {
    return this._service.getSettings(req.user as UserModel);
  }

  @Put()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Met à jour les flags GraphDB (effectifs immédiatement, fail-open Mongo)',
  })
  updateSettings(@Req() req: Request, @Body() body: UpdateGraphdbSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
