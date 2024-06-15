import { MediasService } from '@modules/medias/medias.service';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AnnouncementModel,
  AnnouncementNavigationTypeEnum,
} from '@schemas/announcement.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateAnnouncementDto } from './dto/announcements.dto';

@Injectable()
export class AnnouncementsService {
  @InjectModel(AnnouncementModel.name)
  private readonly _announcementModel: Model<AnnouncementModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  async list() {
    return this._announcementModel
      .find({
        isActive: true,
      })
      .exec();
  }

  async create(
    args: CreateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('not_allowed');
    }

    if (
      args.config.navigationType === AnnouncementNavigationTypeEnum.INTERNAL
    ) {
      args.config.url = `search?searchContent=${
        args.config.query.searchContent
      }&storeId=${args.config.query?.storeId ?? ''}&categoryId=${
        args.config.query?.categoryId ?? ''
      }&productId=${
        args.config.query?.producId ?? ''
      }&minPrice=0&sortBy=createdAt&sortDirection=desc`;
    }

    let pictureUrl: string;

    if (image) {
      pictureUrl = await this._mediasService.upload(
        image,
        user,
        'announcements',
      );
    }
    console.log('🚀 ~ AnnouncementsService ~ args:', args);

    return await this._announcementModel.create({
      ...args,
      ...(pictureUrl && { pictureUrl }),
    });
  }
}
