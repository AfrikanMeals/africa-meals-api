import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { CreateStoreDto } from './dto/store.dto';
import { StoreService } from './store.service';

@Controller('stores')
export class StoreController {
  @Inject(StoreService)
  private readonly _storeService: StoreService;

  @Get('/:id')
  async findOneById(@Param('id') id: string) {
    return this._storeService.findOneById(id);
  }

  @Post('')
  @UseGuards(JwtGuard)
  async create(
    @Req() req: Request,
    @Body(ValidationPipe) args: CreateStoreDto,
  ) {
    return this._storeService.create(args, req.user as UserModel);
  }

  @Patch('/:id/profile-image')
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
  async uploadProfileImage(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Param('id') id: string,
  ) {
    if (!file) {
      throw new BadRequestException('file_not_provided');
    }

    return this._storeService.updateProfileImage(
      id,
      file,
      req.user as UserModel,
    );
  }
}
