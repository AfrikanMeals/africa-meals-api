import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';
import { slimAnnouncementForClient } from '@utils/public-client-shapes';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/announcements.dto';

@ApiTags('announcements')
@ApiBearerAuth('bearer')
@Controller('announcements')
export class AnnouncementsController {
  @Inject(AnnouncementsService)
  private readonly _announcementsService: AnnouncementsService;

  @Get('')
  @UseGuards(JwtGuard)
  async list() {
    const docs = await this._announcementsService.list();
    const items = docs.map((d) => {
      const toJson = (d as { toJSON?: () => Record<string, unknown> })?.toJSON;
      const row =
        typeof toJson === 'function'
          ? toJson.call(d)
          : (JSON.parse(JSON.stringify(d)) as Record<string, unknown>);
      return slimAnnouncementForClient(row);
    });
    return { items };
  }

  @Post('')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50 MB
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
      // preservePath: true,
    }),
  )
  async create(
    @Body(MultipartToJsonPipe, ValidationPipe) args: CreateAnnouncementDto,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this._announcementsService.create(args, req.user as UserModel, file);
  }
}
