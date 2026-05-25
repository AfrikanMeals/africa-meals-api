import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CreatePenaltyCustomMotifDto } from './dto/create-penalty-custom-motif.dto';
import { CreatePenaltyDto } from './dto/create-penalty.dto';
import { PenaltyRouteEnum } from './penalty.types';
import { PenaltiesService } from './penalties.service';

@ApiTags('penalties')
@ApiBearerAuth('bearer')
@Controller('penalties')
export class PenaltiesController {
  constructor(private readonly penalties: PenaltiesService) {}

  @Get('routes')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Routes de pénalité / compensation (admin)' })
  listRoutes(@Req() req: Request) {
    return this.penalties.listRoutes();
  }

  @Get('motifs')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Motifs intégrés + personnalisés (admin)' })
  listMotifs(@Req() req: Request) {
    return this.penalties.listMotifs(req.user as UserModel);
  }

  @Post('motifs')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer un motif personnalisé réutilisable (admin)' })
  createMotif(@Req() req: Request, @Body() body: CreatePenaltyCustomMotifDto) {
    return this.penalties.createCustomMotif(req.user as UserModel, body);
  }

  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Historique des pénalités Stripe (admin)' })
  list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('take') take?: string,
    @Query('route') route?: PenaltyRouteEnum,
  ) {
    const p = page != null ? Number(page) : undefined;
    const t = take != null ? Number(take) : undefined;
    return this.penalties.list(req.user as UserModel, {
      page: Number.isFinite(p) ? p : undefined,
      take: Number.isFinite(t) ? t : undefined,
      route,
    });
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Détail d’une pénalité (admin)' })
  getOne(@Req() req: Request, @Param('id') id: string) {
    return this.penalties.getById(req.user as UserModel, id);
  }

  @Post()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Créer et exécuter une pénalité / compensation (transfert ou reversal Connect)',
  })
  create(@Req() req: Request, @Body() body: CreatePenaltyDto) {
    return this.penalties.createAndExecute(req.user as UserModel, body);
  }
}
