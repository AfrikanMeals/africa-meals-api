import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { AddItemToCartDto } from '@modules/cart/dto/cart.dto';
import { CreateOfferDto } from '@modules/offers/dto/offers.dto';
import {
  CreateProductDto,
  PatchProductDto,
} from '@modules/products/dto/products.dto';
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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { MultipartToJsonPipe } from './../../pipes/multipart-to-json/multipart-to-json.pipe';
import { CreateProductExtraDto } from './../products/dto/products.dto';
import {
  CreateStockItemDto,
  PatchStockItemDto,
} from '@modules/stock-items/dto/stock-item.dto';
import { StockItemsService } from '@modules/stock-items/stock-items.service';
import { AdminVendorStoreStatusDto } from './dto/admin-vendor-store.dto';
import { CreateStoreDto } from './dto/store.dto';
import { VendorInvitationDto } from './dto/vendor-invitation.dto';
import { StoreService } from './store.service';

@ApiTags('stores')
@ApiBearerAuth('bearer')
@Controller('stores')
export class StoreController {
  @Inject(StoreService)
  private readonly _storeService: StoreService;

  @Inject(StockItemsService)
  private readonly _stockItemsService: StockItemsService;

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

  /** Liste des boutiques (vendeurs) — administrateurs uniquement. */
  @Get('admin/vendors')
  @UseGuards(JwtGuard)
  async listVendorStoresForAdmin(@Req() req: Request) {
    return this._storeService.listVendorStoresForAdmin(req.user as UserModel);
  }

  /** Approuver (ACTIVE) ou suspendre (INACTIVE) une boutique — administrateurs uniquement. */
  @Patch('admin/vendors/:storeId/status')
  @UseGuards(JwtGuard)
  async patchVendorStoreStatus(
    @Param('storeId') storeId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdminVendorStoreStatusDto,
    @Req() req: Request,
  ) {
    return this._storeService.setVendorStoreStatusForAdmin(
      storeId,
      body.status,
      req.user as UserModel,
    );
  }

  /** Invitation par e-mail (lien d’inscription restaurant) — administrateurs uniquement. */
  @Post('admin/vendors/invitation-email')
  @UseGuards(JwtGuard)
  async postVendorInvitationEmail(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: VendorInvitationDto,
  ) {
    return this._storeService.sendVendorInvitationEmail(
      req.user as UserModel,
      body,
    );
  }

  /** Produits du magasin (propriétaire uniquement). */
  @Get(':id/products')
  @UseGuards(JwtGuard)
  async listStoreProducts(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this._storeService.listStoreProducts(id, req.user as UserModel);
  }

  /** Lignes de stock (ingrédients) — propriétaire de la boutique. */
  @Get(':id/stock-items')
  @UseGuards(JwtGuard)
  async listStockItems(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this._stockItemsService.findByStoreForOwner(id, req.user as UserModel);
  }

  @Post(':id/stock-items')
  @UseGuards(JwtGuard)
  async createStockItem(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateStockItemDto,
    @Req() req: Request,
  ) {
    return this._stockItemsService.createForStore(
      id,
      body,
      req.user as UserModel,
    );
  }

  @Patch(':id/stock-items/:itemId')
  @UseGuards(JwtGuard)
  async patchStockItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchStockItemDto,
    @Req() req: Request,
  ) {
    return this._stockItemsService.updateForStore(
      id,
      itemId,
      body,
      req.user as UserModel,
    );
  }

  @Delete(':id/stock-items/:itemId')
  @UseGuards(JwtGuard)
  async deleteStockItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    await this._stockItemsService.deleteForStore(
      id,
      itemId,
      req.user as UserModel,
    );
    return { ok: true };
  }

  @Patch('/:id/products/:productId')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'gallery', maxCount: 2 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
          if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
            return cb(new Error('invalid_file_type'), false);
          }
          cb(null, true);
        },
      },
    ),
  )
  async updateStoreProduct(
    @Req() req: Request,
    @UploadedFiles()
    files: { image?: Express.Multer.File[]; gallery?: Express.Multer.File[] },
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body(MultipartToJsonPipe, ValidationPipe) args: PatchProductDto,
  ) {
    return this._storeService.updateStoreProduct(
      id,
      productId,
      args,
      req.user as UserModel,
      files?.image?.[0],
      files?.gallery,
    );
  }

  @Delete('/:id/products/:productId')
  @UseGuards(JwtGuard)
  async deleteStoreProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Req() req: Request,
  ) {
    return this._storeService.deleteStoreProduct(
      id,
      productId,
      req.user as UserModel,
    );
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

  /** POST en plus de PATCH : certains proxys / runtimes tronquent le corps multipart sur PATCH. */
  @Post('/:id/profile-image')
  @Patch('/:id/profile-image')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50 MB
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png)$/i)) {
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
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'gallery', maxCount: 2 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
          if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
            return cb(new Error('invalid_file_type'), false);
          }
          cb(null, true);
        },
      },
    ),
  )
  async createProduct(
    @Req() req: Request,
    @UploadedFiles()
    files: { image?: Express.Multer.File[]; gallery?: Express.Multer.File[] },
    @Param('id') id: string,
    @Body(MultipartToJsonPipe, ValidationPipe) args: CreateProductDto,
  ) {
    return this._storeService.createProduct(
      id,
      args,
      req.user as UserModel,
      files?.image?.[0],
      files?.gallery,
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
