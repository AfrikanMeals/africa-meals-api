import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdatePartnerBadgeDto } from './dto/update-partner-badge.dto';
import { PartnerBadgesService } from './partner-badges.service';

@ApiTags('partner-badges')
@ApiBearerAuth('bearer')
@Controller('partner-badges')
export class PartnerBadgesController {
  @Inject(PartnerBadgesService)
  private readonly _badges: PartnerBadgesService;

  @Get('admin')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — catalogue des badges partenaires.' })
  listAdmin(@Req() req: Request) {
    return this._badges.listForAdmin(req.user as UserModel);
  }

  @Patch('admin/:code')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Admin — modifier un badge partenaire.' })
  updateAdmin(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: UpdatePartnerBadgeDto,
  ) {
    return this._badges.updateForAdmin(req.user as UserModel, code, body);
  }

  /** Catalogue public authentifié (assignation admin vendeurs / livreurs). */
  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Liste des badges partenaires (runtime).' })
  list(@Req() req: Request) {
    const user = req.user as UserModel;
    if (user.type !== UserTypeEnum.ADMIN) {
      return this._badges.listForRuntime();
    }
    return this._badges.listForAdmin(user);
  }
}
