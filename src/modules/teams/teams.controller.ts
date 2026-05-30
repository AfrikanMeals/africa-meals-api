import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  AddStoreMemberDto,
  AssignPlatformRoleDto,
  CreatePlatformRoleDto,
  CreateStoreRoleDto,
  UpdatePlatformRoleDto,
  UpdateStoreMemberDto,
  UpdateStoreRoleDto,
} from './dto/teams.dto';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@ApiBearerAuth('bearer')
@Controller('teams')
export class TeamsController {
  @Inject(TeamsService) private readonly teams: TeamsService;

  @Get('permissions/catalog')
  @UseGuards(JwtGuard)
  getCatalog() {
    return this.teams.getPermissionsCatalog();
  }

  @Get('access/me')
  @UseGuards(JwtGuard)
  getMyAccess(@Req() req: Request) {
    return this.teams.buildAccessPayload(req.user as UserModel);
  }

  @Get('my-store')
  @UseGuards(JwtGuard)
  getMyStore(@Req() req: Request) {
    return this.teams.getMyStoreContext(req.user as UserModel);
  }

  @Get('stores/:storeId/roles')
  @UseGuards(JwtGuard)
  listStoreRoles(@Req() req: Request, @Param('storeId') storeId: string) {
    return this.teams.listStoreRoles(req.user as UserModel, storeId);
  }

  @Post('stores/:storeId/roles')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createStoreRole(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body() body: CreateStoreRoleDto,
  ) {
    return this.teams.createStoreRole(req.user as UserModel, storeId, body);
  }

  @Patch('stores/:storeId/roles/:roleId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateStoreRole(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
    @Body() body: UpdateStoreRoleDto,
  ) {
    return this.teams.updateStoreRole(
      req.user as UserModel,
      storeId,
      roleId,
      body,
    );
  }

  @Delete('stores/:storeId/roles/:roleId')
  @UseGuards(JwtGuard)
  deleteStoreRole(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.teams.deleteStoreRole(req.user as UserModel, storeId, roleId);
  }

  @Get('stores/:storeId/members')
  @UseGuards(JwtGuard)
  listStoreMembers(@Req() req: Request, @Param('storeId') storeId: string) {
    return this.teams.listStoreMembers(req.user as UserModel, storeId);
  }

  @Post('stores/:storeId/members')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  addStoreMember(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body() body: AddStoreMemberDto,
  ) {
    return this.teams.addStoreMember(req.user as UserModel, storeId, body);
  }

  @Patch('stores/:storeId/members/:memberId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateStoreMember(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('memberId') memberId: string,
    @Body() body: UpdateStoreMemberDto,
  ) {
    return this.teams.updateStoreMember(
      req.user as UserModel,
      storeId,
      memberId,
      body,
    );
  }

  @Delete('stores/:storeId/members/:memberId')
  @UseGuards(JwtGuard)
  removeStoreMember(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.teams.removeStoreMember(
      req.user as UserModel,
      storeId,
      memberId,
    );
  }

  @Get('admin/roles')
  @UseGuards(JwtGuard)
  listPlatformRoles(@Req() req: Request) {
    return this.teams.listPlatformRoles(req.user as UserModel);
  }

  @Post('admin/roles')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createPlatformRole(@Req() req: Request, @Body() body: CreatePlatformRoleDto) {
    return this.teams.createPlatformRole(req.user as UserModel, body);
  }

  @Patch('admin/roles/:roleId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updatePlatformRole(
    @Req() req: Request,
    @Param('roleId') roleId: string,
    @Body() body: UpdatePlatformRoleDto,
  ) {
    return this.teams.updatePlatformRole(req.user as UserModel, roleId, body);
  }

  @Delete('admin/roles/:roleId')
  @UseGuards(JwtGuard)
  deletePlatformRole(@Req() req: Request, @Param('roleId') roleId: string) {
    return this.teams.deletePlatformRole(req.user as UserModel, roleId);
  }

  @Get('admin/members')
  @UseGuards(JwtGuard)
  listPlatformMembers(@Req() req: Request) {
    return this.teams.listPlatformMembers(req.user as UserModel);
  }

  @Patch('admin/members/:userId/role')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  assignPlatformRole(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body() body: AssignPlatformRoleDto,
  ) {
    return this.teams.assignPlatformRole(req.user as UserModel, userId, body);
  }
}
