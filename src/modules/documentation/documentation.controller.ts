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
import { DocumentationService } from './documentation.service';
import { UpsertDocumentationGroupDto } from './dto/upsert-documentation-group.dto';
import { UpsertDocumentationSubjectDto } from './dto/upsert-documentation-subject.dto';
import { UpsertDocumentationTopicDto } from './dto/upsert-documentation-topic.dto';

@ApiTags('documentation')
@Controller('documentation')
export class DocumentationController {
  constructor(private readonly _documentation: DocumentationService) {}

  @Get('public')
  @ApiOperation({
    summary: 'Hub documentation (groupes + topics + sujets publiés)',
  })
  getPublicHub(@Query('locale') locale?: string) {
    return this._documentation.getPublicHub(locale);
  }

  @Get('public/topics/:slug')
  @ApiOperation({ summary: 'Topic publié + liste des sujets' })
  getPublicTopic(
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._documentation.getPublishedTopic(slug, locale);
  }

  @Get('public/subjects/:slug')
  @ApiOperation({ summary: 'Article (subject) publié' })
  getPublicSubject(
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._documentation.getPublishedSubject(slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/groups')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les groupes (ADMIN)' })
  listGroupsAdmin(@Req() req: Request) {
    return this._documentation.listGroupsForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/topics')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les topics (ADMIN)' })
  listTopicsAdmin(@Req() req: Request) {
    return this._documentation.listTopicsForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/subjects')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lister les sujets / articles (ADMIN)' })
  listSubjectsAdmin(@Req() req: Request) {
    return this._documentation.listSubjectsForAdmin(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/groups')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour un groupe (ADMIN)' })
  upsertGroup(@Req() req: Request, @Body() body: UpsertDocumentationGroupDto) {
    return this._documentation.upsertGroup(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/topics')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour un topic (ADMIN)' })
  upsertTopic(@Req() req: Request, @Body() body: UpsertDocumentationTopicDto) {
    return this._documentation.upsertTopic(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Put('admin/subjects')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Créer / mettre à jour un sujet / article (ADMIN)' })
  upsertSubject(
    @Req() req: Request,
    @Body() body: UpsertDocumentationSubjectDto,
  ) {
    return this._documentation.upsertSubject(req.user as UserModel, body);
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
    return this._documentation.deleteGroup(req.user as UserModel, slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Delete('admin/topics/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Supprimer un topic (ADMIN)' })
  deleteTopic(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._documentation.deleteTopic(req.user as UserModel, slug, locale);
  }

  @ApiBearerAuth('bearer')
  @Delete('admin/subjects/:slug')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Supprimer un sujet / article (ADMIN)' })
  deleteSubject(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this._documentation.deleteSubject(req.user as UserModel, slug, locale);
  }
}
