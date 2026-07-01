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
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { slimAnnouncementForClient } from '@utils/public-client-shapes';
import { Request } from 'express';
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';
import { AnnouncementImageJsonDto } from './dto/announcement-image.dto';

function toClientRows(docs: unknown[]): Record<string, unknown>[] {
  return docs.map((d) => {
    const row =
      d && typeof d === 'object'
        ? (JSON.parse(JSON.stringify(d)) as Record<string, unknown>)
        : {};
    return slimAnnouncementForClient(row);
  });
}

@ApiTags('announcements')
@ApiBearerAuth('bearer')
@Controller('announcements')
export class AnnouncementsController {
  @Inject(AnnouncementsService)
  private readonly _announcementsService: AnnouncementsService;

  @Get('')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async list(
    @Req() req: Request,
    @Query() query: ListAnnouncementsQueryDto,
  ) {
    const user = req.user as UserModel;
    const docs = query.placement
      ? await this._announcementsService.listForUser({
          user,
          placement: query.placement,
          regionCode: query.regionCode,
        })
      : await this._announcementsService.list();
    return { items: toClientRows(docs) };
  }

  @Get('manage')
  @UseGuards(JwtGuard)
  async listManage(@Req() req: Request) {
    const docs = await this._announcementsService.listManage(
      req.user as UserModel,
    );
    return { items: toClientRows(docs) };
  }

  /** JSON + base64 : recommandé derrière proxys (multipart « Unexpected end of form »). */
  @Post('image-json')
  @UseGuards(JwtGuard)
  async uploadImageJson(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AnnouncementImageJsonDto,
  ) {
    return this._announcementsService.uploadAnnouncementImageJson(
      req.user as UserModel,
      body,
    );
  }

  @Post('')
  @UseGuards(JwtGuard)
  async create(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateAnnouncementDto,
    @Req() req: Request,
  ) {
    const created = await this._announcementsService.create(
      body,
      req.user as UserModel,
    );
    return slimAnnouncementForClient(created as Record<string, unknown>);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateAnnouncementDto,
    @Req() req: Request,
  ) {
    const updated = await this._announcementsService.update(
      id,
      body,
      req.user as UserModel,
    );
    return slimAnnouncementForClient(updated as Record<string, unknown>);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async remove(@Param('id') id: string, @Req() req: Request) {
    return this._announcementsService.remove(id, req.user as UserModel);
  }

  @Post(':id/dismiss')
  @UseGuards(JwtGuard)
  async dismiss(@Param('id') id: string, @Req() req: Request) {
    return this._announcementsService.dismiss(id, req.user as UserModel);
  }
}
