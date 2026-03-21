import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { AddItemToCartDto } from '@modules/cart/dto/cart.dto';
import { CreateOfferDto } from '@modules/offers/dto/offers.dto';
import { CreateProductDto } from '@modules/products/dto/products.dto';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { MultipartToJsonPipe } from './../../pipes/multipart-to-json/multipart-to-json.pipe';
import { CreateProductExtraDto } from './../products/dto/products.dto';
import { CreateStoreDto } from './dto/store.dto';
import { StoreService } from './store.service';

@ApiTags('stores')
@ApiBearerAuth('bearer')
@Controller('stores')
export class StoreController {
  @Inject(StoreService)
  private readonly _storeService: StoreService;

  /** Résumé vendeur (évite la collision avec GET :id = "my-store"). */
  @Get('vendor/summary')
  @UseGuards(JwtGuard)
  async getVendorSummary(@Req() req: Request) {
    return this._storeService.findMyStoreSummary(req.user as UserModel);
  }

  /** Fil unique : messages boutique (`stores.vendor_messages`) + fil user (`users.reward_history`). */
  @Get('vendor/notifications')
  @UseGuards(JwtGuard)
  async getVendorNotifications(@Req() req: Request) {
    return this._storeService.findMyNotificationFeed(req.user as UserModel);
  }

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

  @Patch('vendor/application')
  @UseGuards(JwtGuard)
  async patchVendorApplication(
    @Req() req: Request,
    @Body(ValidationPipe) args: CreateStoreDto,
  ) {
    return this._storeService.updateVendorApplication(
      req.user as UserModel,
      args,
    );
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

  @Post('/:id/product')
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
  async createProduct(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Param('id') id: string,
    @Body(MultipartToJsonPipe, ValidationPipe) args: CreateProductDto,
  ) {
    return this._storeService.createProduct(
      id,
      args,
      req.user as UserModel,
      file,
    );
  }

  @Post('/:id/products/:producId/extra')
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
  async createProductExtra(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('producId') productId: string,
    @Body(MultipartToJsonPipe, ValidationPipe) args: CreateProductExtraDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (file) {
      args.image = file;
    }
    return this._storeService.createProducExtra(
      productId,
      id,
      args,
      req.user as UserModel,
    );
  }

  @Post(':id/rating')
  @UseGuards(JwtGuard)
  async rate(
    @Param('id') id: string,
    @Body(ValidationPipe) args: CreateRatingDto,
    @Req() req: Request,
  ) {
    return this._storeService.createRating(id, args, req.user as UserModel);
  }

  @Post(':id/cart')
  @UseGuards(JwtGuard)
  async addItemToStoreCart(
    @Param('id') id: string,
    @Body(ValidationPipe) args: AddItemToCartDto,
    @Req() req: Request,
  ) {
    return await this._storeService.addItemToStoreCart(
      id,
      args,
      req.user as UserModel,
    );
  }

  @Post(':id/order')
  @UseGuards(JwtGuard)
  async createOrderFromCart(@Param('id') id: string, @Req() req: Request) {
    return await this._storeService.createOrderFromCart(
      id,
      req.user as UserModel,
    );
  }

  @Post('/:id/offer')
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
  async createOffer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(MultipartToJsonPipe, ValidationPipe) args: CreateOfferDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<any> {
    if (file) {
      args.image = file;
    }
    return this._storeService.createOffer(id, args, req.user as UserModel);
  }

  @Delete('/:id/products/:producId/extra/:extraId')
  @UseGuards(JwtGuard)
  async deleteExtra(
    @Param('id') id: string,
    @Param('extraId') extraId: string,
    @Param('producId') productId: string,
    @Req() req: Request,
  ) {
    return this._storeService.deleteProductExtra(
      id,
      productId,
      extraId,
      req.user as UserModel,
    );
  }
}
