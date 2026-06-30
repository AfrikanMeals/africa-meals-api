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
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { slimAnnouncementForClient } from '@utils/public-client-shapes';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

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

  @Post('')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async create(
    @Body(MultipartToJsonPipe, ValidationPipe) args: CreateAnnouncementDto,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const created = await this._announcementsService.create(
      args,
      req.user as UserModel,
      file,
    );
    return slimAnnouncementForClient(
      JSON.parse(JSON.stringify(created)) as Record<string, unknown>,
    );
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async update(
    @Param('id') id: string,
    @Body(MultipartToJsonPipe, ValidationPipe) args: UpdateAnnouncementDto,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const updated = await this._announcementsService.update(
      id,
      args,
      req.user as UserModel,
      file,
    );
    return slimAnnouncementForClient(
      JSON.parse(JSON.stringify(updated)) as Record<string, unknown>,
    );
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
