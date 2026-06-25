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
import { AdminCatalogModerationService } from './admin-catalog-moderation.service';
import { BlockCatalogModerationDto } from './dto/block-catalog-moderation.dto';
import { ListCatalogModerationQueryDto } from './dto/list-catalog-moderation-query.dto';

@ApiTags('Admin — Catalog moderation')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('admin/catalog-moderation')
export class AdminCatalogModerationController {
  constructor(
    private readonly catalogModeration: AdminCatalogModerationService,
  ) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Liste plats, boissons et articles stock créés par les vendeurs (admin.catalog)',
  })
  list(@Req() req: Request, @Query() query: ListCatalogModerationQueryDto) {
    return this.catalogModeration.list(req.user as UserModel, query);
  }

  @Post(':kind/:itemId/block')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Bloquer un élément catalogue avec motif' })
  block(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('itemId') itemId: string,
    @Body() body: BlockCatalogModerationDto,
  ) {
    return this.catalogModeration.blockItem(
      req.user as UserModel,
      kind,
      itemId,
      body.blockReason,
    );
  }

  @Post(':kind/:itemId/unblock')
  @ApiOperation({ summary: 'Lever le blocage modération d’un élément catalogue' })
  unblock(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('itemId') itemId: string,
  ) {
    return this.catalogModeration.unblockItem(
      req.user as UserModel,
      kind,
      itemId,
    );
  }
}
