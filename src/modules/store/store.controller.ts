import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { AddItemToCartDto } from '@modules/cart/dto/cart.dto';
import { CreateOfferDto } from '@modules/offers/dto/offers.dto';
import {
  CreateProductDto,
  CreateProductJsonDto,
  PatchProductDto,
  PatchProductJsonDto,
} from '@modules/products/dto/products.dto';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import {
  BadRequestException,
  Body,
  NotFoundException,
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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
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
import {
  CreateDrinkDto,
  CreateDrinkJsonDto,
  PatchDrinkDto,
  PatchDrinkJsonDto,
} from '@modules/drinks/dto/drink.dto';
import { DrinksService } from '@modules/drinks/drinks.service';
import {
  VendorCatalogDrinksQueryDto,
  VendorCatalogProductsQueryDto,
} from './dto/vendor-catalog-query.dto';
import { StockItemsService } from '@modules/stock-items/stock-items.service';
import { AdminVendorStoreStatusDto } from './dto/admin-vendor-store.dto';
import {
  CreateStoreDto,
  PatchDailyMenuDto,
  PatchVendorShippingZonesDto,
  StoreProfileImageJsonDto,
} from './dto/store.dto';
import { VendorInvitationDto } from './dto/vendor-invitation.dto';
import { StoreService } from './store.service';

const VENDOR_PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function multerFileFromVendorProductBase64(
  imageBase64: string | undefined,
  filename: string | undefined,
  fieldname: 'image' | 'gallery',
): Express.Multer.File | undefined {
  if (imageBase64 == null || String(imageBase64).trim() === '') {
    return undefined;
  }
  const raw = String(imageBase64)
    .replace(/\s/g, '')
    .replace(/^data:image\/[^;]+;base64,/i, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw new BadRequestException('invalid_base64');
  }
  if (!buffer.length) {
    throw new BadRequestException('empty_image');
  }
  if (buffer.length > VENDOR_PRODUCT_IMAGE_MAX_BYTES) {
    throw new BadRequestException('image_too_large');
  }
  const name = (filename || 'photo.jpg').trim() || 'photo.jpg';
  if (!/\.(jpe?g|png)$/i.test(name)) {
    throw new BadRequestException('invalid_file_type');
  }
  const mime = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return {
    fieldname,
    originalname: name,
    encoding: '7bit',
    mimetype: mime,
    buffer,
    size: buffer.length,
    destination: '',
    filename: '',
    path: '',
    stream: undefined,
  } as Express.Multer.File;
}

function galleryMulterFilesFromJson(
  galleryBase64: string[] | undefined,
  galleryFilenames: string[] | undefined,
): Express.Multer.File[] | undefined {
  if (!galleryBase64?.length) {
    return undefined;
  }
  const out: Express.Multer.File[] = [];
  const n = Math.min(2, galleryBase64.length);
  for (let i = 0; i < n; i++) {
    const f = multerFileFromVendorProductBase64(
      galleryBase64[i],
      galleryFilenames?.[i],
      'gallery',
    );
    if (f) {
      out.push(f);
    }
  }
  return out.length ? out : undefined;
}

const DRINK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Image boisson depuis JSON (WebP autorisé, comme le multipart boissons). */
function multerFileFromDrinkImageJson(
  imageBase64: string | undefined,
  filename: string | undefined,
): Express.Multer.File | undefined {
  if (imageBase64 == null || String(imageBase64).trim() === '') {
    return undefined;
  }
  const raw = String(imageBase64)
    .replace(/\s/g, '')
    .replace(/^data:image\/[^;]+;base64,/i, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw new BadRequestException('invalid_base64');
  }
  if (!buffer.length) {
    throw new BadRequestException('empty_image');
  }
  if (buffer.length > DRINK_IMAGE_MAX_BYTES) {
    throw new BadRequestException('file_too_large');
  }
  const name = (filename || 'drink.jpg').trim() || 'drink.jpg';
  if (!/\.(jpe?g|png|webp)$/i.test(name)) {
    throw new BadRequestException('invalid_file_type');
  }
  const lower = name.toLowerCase();
  const mime = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
    ? 'image/webp'
    : 'image/jpeg';
  return {
    fieldname: 'image',
    originalname: name,
    encoding: '7bit',
    mimetype: mime,
    buffer,
    size: buffer.length,
    destination: '',
    filename: '',
    path: '',
    stream: undefined,
  } as Express.Multer.File;
}

@ApiTags('stores')
@ApiBearerAuth('bearer')
@Controller('stores')
export class StoreController {
  @Inject(StoreService)
  private readonly _storeService: StoreService;

  @Inject(StockItemsService)
  private readonly _stockItemsService: StockItemsService;

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  /** Résumé vendeur (évite la collision avec GET :id = "my-store"). */
  @Get('vendor/summary')
  @UseGuards(JwtGuard)
  async getVendorSummary(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
  ) {
    return this._storeService.findMyStoreSummary(
      req.user as UserModel,
      storeId,
    );
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

  /** Suppression d’une boutique non approuvée (PENDING / REVISION) — administrateurs uniquement. */
  @Delete('admin/vendors/:storeId')
  @UseGuards(JwtGuard)
  async deleteVendorStore(
    @Param('storeId') storeId: string,
    @Req() req: Request,
  ) {
    return this._storeService.deleteVendorStoreForAdmin(
      storeId,
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
  async listStoreProducts(@Param('id') id: string, @Req() req: Request) {
    return this._storeService.listStoreProducts(id, req.user as UserModel);
  }

  @Get(':id/products/:productId')
  @UseGuards(JwtGuard)
  async getStoreProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Req() req: Request,
  ) {
    return this._storeService.getStoreProductForOwner(
      id,
      productId,
      req.user as UserModel,
    );
  }

  /** Catalogue vendeur mobile — plats (food ou menu du jour). */
  @Get(':id/vendor-catalog/products')
  @UseGuards(JwtGuard)
  async listVendorCatalogProducts(
    @Param('id') id: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: VendorCatalogProductsQueryDto,
    @Req() req: Request,
  ) {
    const tab = query.tab === 'daily_menu' ? 'daily_menu' : 'food';
    return this._storeService.listVendorCatalogProducts(
      id,
      req.user as UserModel,
      {
        page: query.page ?? 1,
        take: query.take ?? 20,
        q: query.q,
        tab,
      },
    );
  }

  /** Catalogue vendeur mobile — boissons. */
  @Get(':id/vendor-catalog/drinks')
  @UseGuards(JwtGuard)
  async listVendorCatalogDrinks(
    @Param('id') id: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    query: VendorCatalogDrinksQueryDto,
    @Req() req: Request,
  ) {
    return this._drinksService.findByStoreForOwnerPaginated(
      id,
      req.user as UserModel,
      {
        page: query.page ?? 1,
        take: query.take ?? 20,
        q: query.q,
      },
    );
  }

  /** Lignes de stock (ingrédients) — propriétaire de la boutique. */
  @Get(':id/stock-items')
  @UseGuards(JwtGuard)
  async listStockItems(@Param('id') id: string, @Req() req: Request) {
    return this._stockItemsService.findByStoreForOwner(
      id,
      req.user as UserModel,
    );
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

  /** Boissons (table `drinks`) — propriétaire de la boutique. */
  @Get(':id/drinks')
  @UseGuards(JwtGuard)
  async listDrinks(@Param('id') id: string, @Req() req: Request) {
    return this._drinksService.findByStoreForOwner(id, req.user as UserModel);
  }

  @Get(':id/drinks/:drinkId')
  @UseGuards(JwtGuard)
  async getDrink(
    @Param('id') id: string,
    @Param('drinkId') drinkId: string,
    @Req() req: Request,
  ) {
    return this._drinksService.findOneForStoreOwner(
      id,
      drinkId,
      req.user as UserModel,
    );
  }

  /**
   * Création boisson en JSON (+ image base64 optionnelle) — fiable derrière
   * Firebase / CF où le multipart est souvent tronqué (« Unexpected end of form »).
   */
  @Post(':id/drinks-json')
  @UseGuards(JwtGuard)
  async createDrinkJson(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateDrinkJsonDto,
    @Req() req: Request,
  ) {
    const { imageBase64, filename, ...createDto } = body;
    const file = multerFileFromDrinkImageJson(imageBase64, filename);
    return this._drinksService.createForStore(
      id,
      createDto as CreateDrinkDto,
      req.user as UserModel,
      file,
    );
  }

  @Patch(':id/drinks/:drinkId/json')
  @UseGuards(JwtGuard)
  async patchDrinkJson(
    @Param('id') id: string,
    @Param('drinkId') drinkId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchDrinkJsonDto,
    @Req() req: Request,
  ) {
    const { imageBase64, filename, ...patch } = body;
    const file = multerFileFromDrinkImageJson(imageBase64, filename);
    return this._drinksService.updateForStore(
      id,
      drinkId,
      patch as PatchDrinkDto,
      req.user as UserModel,
      file,
    );
  }

  @Post(':id/drinks')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async createDrink(
    @Param('id') id: string,
    @Body(
      MultipartToJsonPipe,
      new ValidationPipe({ transform: true, whitelist: true }),
    )
    body: CreateDrinkDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this._drinksService.createForStore(
      id,
      body,
      req.user as UserModel,
      file,
    );
  }

  @Patch(':id/drinks/:drinkId')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async patchDrink(
    @Param('id') id: string,
    @Param('drinkId') drinkId: string,
    @Body(
      MultipartToJsonPipe,
      new ValidationPipe({ transform: true, whitelist: true }),
    )
    body: PatchDrinkDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this._drinksService.updateForStore(
      id,
      drinkId,
      body,
      req.user as UserModel,
      file,
    );
  }

  @Delete(':id/drinks/:drinkId')
  @UseGuards(JwtGuard)
  async deleteDrink(
    @Param('id') id: string,
    @Param('drinkId') drinkId: string,
    @Req() req: Request,
  ) {
    await this._drinksService.deleteForStore(
      id,
      drinkId,
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
    @Body(
      MultipartToJsonPipe,
      new ValidationPipe({ transform: true, whitelist: true }),
    )
    args: PatchProductDto,
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

  /**
   * Méta en-tête pour l’app (menu boutique) : léger, sans populate lourd.
   * Doit rester avant `GET /:id` pour que le segment `menu-meta` soit résolu correctement.
   */
  @Get(':id/menu-meta')
  async getStoreMenuMeta(@Param('id') id: string) {
    const meta = await this._storeService.findPublicStoreMenuMeta(id);
    if (meta == null) {
      throw new NotFoundException('store_not_found');
    }
    return meta;
  }

  /** Boissons (`drinks`) visibles client — sans auth (même source que l’admin, filtrées stock > 0). */
  @Get(':id/drinks-catalog')
  async listDrinksCatalog(@Param('id') id: string, @Query('q') q?: string) {
    return this._drinksService.findByStoreForCatalog(id, q);
  }

  @Get('/:id')
  async findOneById(@Param('id') id: string) {
    return this._storeService.findOneById(id, {
      requireMobileVisibility: true,
    });
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

  /** Zones de livraison / livraison par le restaurant (boutique ACTIVE ou dossier en cours). */
  @Patch('vendor/shipping-zones')
  @UseGuards(JwtGuard)
  async patchVendorShippingZones(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchVendorShippingZonesDto,
  ) {
    return this._storeService.updateVendorShippingZones(
      req.user as UserModel,
      body,
    );
  }

  /** Menu du jour : plats proposés par jour de la semaine (propriétaire de la boutique). */
  @Patch(':id/daily-menu')
  @UseGuards(JwtGuard)
  async patchDailyMenu(
    @Param('id') storeId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchDailyMenuDto,
    @Req() req: Request,
  ) {
    return this._storeService.updateVendorDailyMenu(
      storeId,
      req.user as UserModel,
      body.slots,
    );
  }

  /** JSON + base64 : fiable sur Firebase / CF où multipart peut échouer (« Unexpected end of form »). */
  @Post('/:id/profile-image-json')
  @UseGuards(JwtGuard)
  async uploadProfileImageJson(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: StoreProfileImageJsonDto,
    @Req() req: Request,
  ) {
    const raw = body.imageBase64
      .replace(/\s/g, '')
      .replace(/^data:image\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_image');
    }
    const max = 50 * 1024 * 1024;
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (body.filename || 'photo.jpg').trim() || 'photo.jpg';
    if (!/\.(jpe?g|png)$/i.test(name)) {
      throw new BadRequestException('invalid_file_type');
    }
    const mime = name.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';
    const file = {
      fieldname: 'image',
      originalname: name,
      encoding: '7bit',
      mimetype: mime,
      buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as Express.Multer.File;
    return this._storeService.updateProfileImage(
      id,
      file,
      req.user as UserModel,
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

  /** JSON + base64 : fiable sur Firebase / CF où multipart peut échouer (« Unexpected end of form »). */
  @Post('/:id/product-json')
  @UseGuards(JwtGuard)
  async createProductJson(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateProductJsonDto,
    @Req() req: Request,
  ) {
    const args: CreateProductDto = {
      title: body.title,
      bio: body.bio,
      about: body.about,
      fieldsets: body.fieldsets,
      complements: body.complements,
      supplements: body.supplements,
      originCountry: body.originCountry,
      price: body.price,
      discountPrice: body.discountPrice,
      category: body.category,
      currency: body.currency,
      status: body.status,
    };
    const imageFile = multerFileFromVendorProductBase64(
      body.imageBase64,
      body.imageFilename,
      'image',
    );
    const galleryFiles = galleryMulterFilesFromJson(
      body.galleryBase64,
      body.galleryFilenames,
    );
    return this._storeService.createProduct(
      id,
      args,
      req.user as UserModel,
      imageFile,
      galleryFiles,
    );
  }

  /** JSON + base64 (POST) : évite multipart tronqué sur PATCH / derrière proxys. */
  @Post('/:id/products/:productId/json')
  @UseGuards(JwtGuard)
  async updateStoreProductJson(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchProductJsonDto,
    @Req() req: Request,
  ) {
    const imageFile = multerFileFromVendorProductBase64(
      body.imageBase64,
      body.imageFilename,
      'image',
    );
    const galleryFiles = galleryMulterFilesFromJson(
      body.galleryBase64,
      body.galleryFilenames,
    );
    const patch = { ...body } as PatchProductJsonDto & Record<string, unknown>;
    delete patch.imageBase64;
    delete patch.imageFilename;
    delete patch.galleryBase64;
    delete patch.galleryFilenames;
    return this._storeService.updateStoreProduct(
      id,
      productId,
      patch as PatchProductDto,
      req.user as UserModel,
      imageFile,
      galleryFiles,
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

  @Post(':id/favorite')
  @UseGuards(JwtGuard)
  async addToFavorites(@Param('id') id: string, @Req() req: Request) {
    return this._storeService.addToFavorites(id, req.user as UserModel);
  }

  @Delete(':id/favorite')
  @UseGuards(JwtGuard)
  async removeFromFavorites(@Param('id') id: string, @Req() req: Request) {
    return this._storeService.removeFromFavorites(id, req.user as UserModel);
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
