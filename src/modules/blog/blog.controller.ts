import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BlogService } from './blog.service';
import { UpsertBlogArticleDto } from './dto/upsert-blog-article.dto';
import { UpsertBlogGroupDto } from './dto/upsert-blog-group.dto';

@ApiTags('blog')
@Controller('blog')
export class BlogController {
  constructor(private readonly _blog: BlogService) {}

  @Get('public')
  @ApiOperation({ summary: 'Hub blog (groupes + articles publiés)' })
  getPublicHub(@Query('locale') locale?: string) {
    return this._blog.getPublicHub(locale);
  }

  @Get('public/articles/:slug')
  @ApiOperation({ summary: 'Article de blog publié' })
  getPublicArticle(
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._blog.getPublishedArticle(slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/groups')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les groupes (ADMIN)' })
  listGroupsAdmin(@Req() req: Request) {
    return this._blog.listGroupsForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/articles')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les articles (ADMIN)' })
  listArticlesAdmin(@Req() req: Request) {
    return this._blog.listArticlesForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/groups')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour un groupe (ADMIN)' })
  upsertGroup(@Req() req: Request, @Body() body: UpsertBlogGroupDto) {
    return this._blog.upsertGroup(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/articles')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour un article (ADMIN)' })
  upsertArticle(@Req() req: Request, @Body() body: UpsertBlogArticleDto) {
    return this._blog.upsertArticle(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Delete('admin/groups/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Supprimer un groupe (ADMIN)' })
  deleteGroup(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._blog.deleteGroup(req.user as UserModel, slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Delete('admin/articles/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Supprimer un article (ADMIN)' })
  deleteArticle(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._blog.deleteArticle(req.user as UserModel, slug, locale);
  }
}
