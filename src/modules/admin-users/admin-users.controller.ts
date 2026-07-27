import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFieldSelection } from '@common/field-selection/api-field-selection.decorator';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UsageTimeService } from '@modules/usage-time/usage-time.service';
import { AdminAttachPartnerReferralDto } from './dto/admin-attach-partner-referral.dto';
import { AdminUsersService } from './admin-users.service';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminSearchUsersBodyDto } from './dto/admin-search-users-body.dto';
import { AdminSetUserDisabledDto } from './dto/admin-set-user-disabled.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';

@ApiTags('Admin — User management')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly usageTime: UsageTimeService,
  ) {}

  @Get()
  @ApiFieldSelection()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Liste paginée des comptes plateforme (admin.settings)' })
  list(@Req() req: Request, @Query() query: AdminListUsersQueryDto) {
    return this.adminUsers.listUsers(req.user as UserModel, query);
  }

  @Post('search')
  @ApiFieldSelection()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({
    summary:
      'Recherche paginée des comptes (POST, compat admin — filtres dans le corps)',
  })
  search(
    @Req() req: Request,
    @Query() query: AdminListUsersQueryDto,
    @Body() body: AdminSearchUsersBodyDto,
  ) {
    return this.adminUsers.listUsers(req.user as UserModel, {
      ...query,
      search: body.search ?? query.search,
      type: body.type ?? query.type,
      status: body.status ?? query.status,
    });
  }

  @Get(':userId/interests')
  @ApiOperation({
    summary:
      'Profil d’intérêts et préférences comportementales (admin.settings)',
  })
  getInterests(@Req() req: Request, @Param('userId') userId: string) {
    return this.adminUsers.getUserInterests(req.user as UserModel, userId);
  }

  @Get(':userId/usage-time')
  @ApiOperation({
    summary:
      'Temps d’usage app mobile / admin — moyennes et pics de connexion (admin.settings)',
  })
  getUsageTime(@Req() req: Request, @Param('userId') userId: string) {
    return this.usageTime.getUserUsageTime(req.user as UserModel, userId);
  }

  @Post(':userId/partner-referral')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary:
      'Lier un Client / Vendeur / Livreur à un Partner via code referral (admin.settings)',
  })
  attachPartnerReferral(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() dto: AdminAttachPartnerReferralDto,
  ) {
    return this.adminUsers.attachPartnerReferral(
      req.user as UserModel,
      userId,
      dto,
    );
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Détail d’un compte (admin.settings)' })
  getOne(@Req() req: Request, @Param('userId') userId: string) {
    return this.adminUsers.getUser(req.user as UserModel, userId);
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Modifier un compte (admin.settings)' })
  update(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.adminUsers.updateUser(req.user as UserModel, userId, dto);
  }

  @Patch(':userId/disabled')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Activer / désactiver un compte (admin.settings)' })
  setDisabled(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() dto: AdminSetUserDisabledDto,
  ) {
    return this.adminUsers.setUserDisabled(req.user as UserModel, userId, dto);
  }

  @Post(':userId/cancel-deletion')
  @ApiOperation({
    summary: 'Annuler une demande de suppression en attente (admin.settings)',
  })
  cancelDeletion(@Req() req: Request, @Param('userId') userId: string) {
    return this.adminUsers.cancelDeletionRequest(req.user as UserModel, userId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Suppression définitive immédiate (admin.settings)' })
  delete(@Req() req: Request, @Param('userId') userId: string) {
    return this.adminUsers.deleteUser(req.user as UserModel, userId);
  }
}
