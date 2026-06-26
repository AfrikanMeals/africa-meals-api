import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
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
  ForbiddenException,
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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
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
  clientPlatformFromRequest,
  resolveMongoIdFromPublicParam,
} from '@common/catalog-public-id.util';
import {
  VendorCatalogDrinksQueryDto,
  VendorCatalogProductsQueryDto,
} from './dto/vendor-catalog-query.dto';
import { StockItemsService } from '@modules/stock-items/stock-items.service';
import { CatalogLibraryService } from '@modules/catalog-library/catalog-library.service';
import {
  CreateComplementLibraryDto,
  CreateIngredientLibraryDto,
  CreateSupplementLibraryDto,
  PatchComplementLibraryDto,
  PatchIngredientLibraryDto,
  PatchSupplementLibraryDto,
} from '@modules/catalog-library/dto/catalog-library.dto';
import {
  AdminPatchVendorStoreDto,
  AdminVendorRequestRevisionDto,
  AdminVendorStoreStatusDto,
} from './dto/admin-vendor-store.dto';
import {
  CreateStoreDto,
  PatchDailyMenuDto,
  PatchVendorShippingZonesDto,
  PatchVendorWorkingHoursDto,
  StoreProfileImageJsonDto,
} from './dto/store.dto';
import { VendorInvitationDto } from './dto/vendor-invitation.dto';
import { ResetStripeConnectDto } from './dto/reset-stripe-connect.dto';
import { StoreService } from './store.service';
import { SetPartnerBadgeDto } from '@common/partner-badges/dto/set-partner-badge.dto';
import { listPartnerBadgeDefinitions } from '@common/partner-badges/partner-badge.constants';
import { StoreDeliveryDriversService } from '@modules/store-delivery-drivers/store-delivery-drivers.service';
import { StoreSubscribersService } from '@modules/store-subscribers/store-subscribers.service';
import { MediasService } from '@modules/medias/medias.service';
import {
  AcceptStoreDeliveryDriverInviteDto,
  InviteStoreDeliveryDriverDto,
} from '@modules/store-delivery-drivers/dto/store-delivery-drivers.dto';

const DEFAULT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Plafond multer (au-delà de la limite admin configurée). */
const MULTER_HARD_MAX_BYTES = 50 * 1024 * 1024;

function multerFileFromVendorProductBase64(
  imageBase64: string | undefined,
  filename: string | undefined,
  fieldname: 'image' | 'gallery',
  maxBytes = DEFAULT_IMAGE_MAX_BYTES,
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
  if (buffer.length > maxBytes) {
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
  maxBytes = DEFAULT_IMAGE_MAX_BYTES,
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
      maxBytes,
    );
    if (f) {
      out.push(f);
    }
  }
  return out.length ? out : undefined;
}

function multerFileFromDrinkImageJson(
  imageBase64: string | undefined,
  filename: string | undefined,
  maxBytes = DEFAULT_IMAGE_MAX_BYTES,
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
  if (buffer.length > maxBytes) {
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

  @Inject(CatalogLibraryService)
  private readonly _catalogLibraryService: CatalogLibraryService;

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  @Inject(StoreDeliveryDriversService)
  private readonly _storeDeliveryDrivers: StoreDeliveryDriversService;

  @Inject(StoreSubscribersService)
  private readonly _storeSubscribers: StoreSubscribersService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

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

  /** Messages système d'une boutique (léger, temps réel via WS `inbox:feed:refresh`). */
  @Get('vendor/messages')
  @UseGuards(JwtGuard)
  async getVendorStoreMessages(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit != null ? Number.parseInt(limit, 10) : undefined;
    return this._storeService.findMyStoreMessages(
      req.user as UserModel,
      storeId,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
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

  /** Attribuer un badge partenaire (Silver / Gold / Diamond) — boutique active uniquement. */
  @Patch('admin/vendors/:storeId/partner-badge')
  @UseGuards(JwtGuard)
  async patchVendorStorePartnerBadge(
    @Param('storeId') storeId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: SetPartnerBadgeDto,
    @Req() req: Request,
  ) {
    return this._storeService.setVendorStorePartnerBadgeForAdmin(
      storeId,
      req.user as UserModel,
      body.badgeCode ?? null,
    );
  }

  /** Catalogue des badges partenaires (admin). */
  @Get('admin/partner-badges')
  @UseGuards(JwtGuard)
  listPartnerBadges(@Req() req: Request) {
    const user = req.user as UserModel;
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    return listPartnerBadgeDefinitions().map((b) => ({
      code: b.code,
      name: b.name,
      icon: b.icon,
      payoutDelayDays: b.payoutDelayDays,
    }));
  }

  /** Détail fiche onboarding + historique — administrateurs vendeurs. */
  @Get('admin/vendors/:storeId')
  @UseGuards(JwtGuard)
  async getAdminVendorStoreDetail(
    @Param('storeId') storeId: string,
    @Req() req: Request,
  ) {
    return this._storeService.getVendorStoreDetailForAdmin(
      storeId,
      req.user as UserModel,
    );
  }

  /** Édition admin de la fiche onboarding — administrateurs vendeurs. */
  @Patch('admin/vendors/:storeId')
  @UseGuards(JwtGuard)
  async patchAdminVendorStore(
    @Param('storeId') storeId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdminPatchVendorStoreDto,
    @Req() req: Request,
  ) {
    return this._storeService.updateVendorStoreForAdmin(
      storeId,
      req.user as UserModel,
      body,
    );
  }

  /** Demande de corrections au vendeur (REVISION) — administrateurs vendeurs. */
  @Post('admin/vendors/:storeId/request-revision')
  @UseGuards(JwtGuard)
  async postAdminVendorStoreRevision(
    @Param('storeId') storeId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdminVendorRequestRevisionDto,
    @Req() req: Request,
  ) {
    return this._storeService.requestVendorStoreRevisionForAdmin(
      storeId,
      req.user as UserModel,
      body.message,
    );
  }

  /** Archives commandes ouvertes avant reset Stripe Connect (lots par resetBatchId). */
  @Get('admin/stripe-reset-archives/batches')
  @UseGuards(JwtGuard)
  async listStripeResetArchiveBatches(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this._storeService.listStripeResetArchiveBatchesForAdmin(
      req.user as UserModel,
      {
        limit: limit ? Number(limit) : undefined,
        skip: skip ? Number(skip) : undefined,
        storeId,
      },
    );
  }

  @Get('admin/stripe-reset-archives/batches/:resetBatchId')
  @UseGuards(JwtGuard)
  async getStripeResetArchiveBatch(
    @Param('resetBatchId') resetBatchId: string,
    @Req() req: Request,
  ) {
    return this._storeService.getStripeResetArchiveBatchForAdmin(
      req.user as UserModel,
      resetBatchId,
    );
  }

  /** Déconnecte Stripe Connect du vendeur — nouvel onboarding requis. */
  @Post('admin/vendors/:storeId/reset-stripe-connect')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async resetVendorStripeConnect(
    @Param('storeId') storeId: string,
    @Req() req: Request,
    @Body() body: ResetStripeConnectDto,
  ) {
    return this._storeService.resetVendorStripeConnectForAdmin(
      storeId,
      req.user as UserModel,
      { archiveOpenOrders: body.archiveOpenOrders === true },
    );
  }

  /** Suppression d’une boutique — le vendeur peut soumettre une nouvelle fiche. */
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

  /** Bibliothèque ingrédients réutilisables — boutique. */
  @Get(':id/catalog-library/ingredients')
  @UseGuards(JwtGuard)
  async listIngredientLibrary(@Param('id') id: string, @Req() req: Request) {
    return this._catalogLibraryService.listIngredients(
      id,
      req.user as UserModel,
    );
  }

  @Post(':id/catalog-library/ingredients')
  @UseGuards(JwtGuard)
  async createIngredientLibrary(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateIngredientLibraryDto,
    @Req() req: Request,
  ) {
    return this._catalogLibraryService.createIngredient(
      id,
      body,
      req.user as UserModel,
    );
  }

  @Patch(':id/catalog-library/ingredients/:itemId')
  @UseGuards(JwtGuard)
  async patchIngredientLibrary(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchIngredientLibraryDto,
    @Req() req: Request,
  ) {
    return this._catalogLibraryService.patchIngredient(
      id,
      itemId,
      body,
      req.user as UserModel,
    );
  }

  @Delete(':id/catalog-library/ingredients/:itemId')
  @UseGuards(JwtGuard)
  async deleteIngredientLibrary(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    await this._catalogLibraryService.deleteIngredient(
      id,
      itemId,
      req.user as UserModel,
    );
    return { ok: true };
  }

  /** Bibliothèque suppléments réutilisables — boutique. */
  @Get(':id/catalog-library/supplements')
  @UseGuards(JwtGuard)
  async listSupplementLibrary(@Param('id') id: string, @Req() req: Request) {
    return this._catalogLibraryService.listSupplements(
      id,
      req.user as UserModel,
    );
  }

  @Post(':id/catalog-library/supplements')
  @UseGuards(JwtGuard)
  async createSupplementLibrary(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateSupplementLibraryDto,
    @Req() req: Request,
  ) {
    return this._catalogLibraryService.createSupplement(
      id,
      body,
      req.user as UserModel,
    );
  }

  @Patch(':id/catalog-library/supplements/:itemId')
  @UseGuards(JwtGuard)
  async patchSupplementLibrary(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchSupplementLibraryDto,
    @Req() req: Request,
  ) {
    return this._catalogLibraryService.patchSupplement(
      id,
      itemId,
      body,
      req.user as UserModel,
    );
  }

  @Delete(':id/catalog-library/supplements/:itemId')
  @UseGuards(JwtGuard)
  async deleteSupplementLibrary(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    await this._catalogLibraryService.deleteSupplement(
      id,
      itemId,
      req.user as UserModel,
    );
    return { ok: true };
  }

  /** Bibliothèque compléments réutilisables — boutique. */
  @Get(':id/catalog-library/complements')
  @UseGuards(JwtGuard)
  async listComplementLibrary(@Param('id') id: string, @Req() req: Request) {
    return this._catalogLibraryService.listComplements(
      id,
      req.user as UserModel,
    );
  }

  @Post(':id/catalog-library/complements')
  @UseGuards(JwtGuard)
  async createComplementLibrary(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateComplementLibraryDto,
    @Req() req: Request,
  ) {
    return this._catalogLibraryService.createComplement(
      id,
      body,
      req.user as UserModel,
    );
  }

  @Patch(':id/catalog-library/complements/:itemId')
  @UseGuards(JwtGuard)
  async patchComplementLibrary(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchComplementLibraryDto,
    @Req() req: Request,
  ) {
    return this._catalogLibraryService.patchComplement(
      id,
      itemId,
      body,
      req.user as UserModel,
    );
  }

  @Delete(':id/catalog-library/complements/:itemId')
  @UseGuards(JwtGuard)
  async deleteComplementLibrary(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    await this._catalogLibraryService.deleteComplement(
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
    const maxBytes = await this._mediasService.getMaxFileSizeBytes();
    const { imageBase64, filename, ...createDto } = body;
    const file = multerFileFromDrinkImageJson(imageBase64, filename, maxBytes);
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
    const maxBytes = await this._mediasService.getMaxFileSizeBytes();
    const { imageBase64, filename, ...patch } = body;
    const file = multerFileFromDrinkImageJson(imageBase64, filename, maxBytes);
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
      limits: { fileSize: MULTER_HARD_MAX_BYTES, files: 1 },
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
      limits: { fileSize: MULTER_HARD_MAX_BYTES, files: 1 },
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
        limits: { fileSize: MULTER_HARD_MAX_BYTES },
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
  @UseGuards(OptionalAuthGuard)
  async getStoreMenuMeta(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('countryCode') countryCode?: string,
  ) {
    const storeId = resolveMongoIdFromPublicParam(id) ?? id;
    const meta = await this._storeService.findPublicStoreMenuMeta(storeId, {
      clientPlatform: clientPlatformFromRequest(req),
      countryCode,
      user: req.user as UserModel | undefined,
    });
    if (meta == null) {
      throw new NotFoundException('store_not_found');
    }
    return meta;
  }

  /** Boissons (`drinks`) visibles client — sans auth (même source que l’admin, filtrées stock > 0). */
  @Get(':id/drinks-catalog')
  @UseGuards(OptionalAuthGuard)
  async listDrinksCatalog(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('countryCode') countryCode?: string,
  ) {
    const storeId = resolveMongoIdFromPublicParam(id) ?? id;
    return this._drinksService.findByStoreForCatalog(
      storeId,
      q,
      clientPlatformFromRequest(req),
      countryCode,
      req.user as UserModel | undefined,
    );
  }

  /** Détail boisson catalogue client (sans auth) — page vitrine / SEO. */
  @Get(':id/drinks-catalog/:drinkId')
  @UseGuards(OptionalAuthGuard)
  async getDrinkCatalog(
    @Param('id') id: string,
    @Param('drinkId') drinkId: string,
    @Req() req: Request,
    @Query('countryCode') countryCode?: string,
  ) {
    const storeId = resolveMongoIdFromPublicParam(id) ?? id;
    const resolvedDrinkId = resolveMongoIdFromPublicParam(drinkId) ?? drinkId;
    const drink = await this._drinksService.findOneInStoreCatalogForWeb(
      storeId,
      resolvedDrinkId,
      clientPlatformFromRequest(req),
      countryCode,
      req.user as UserModel | undefined,
    );
    if (drink == null) {
      throw new NotFoundException('drink_not_found');
    }
    return drink;
  }

  @Get('/:id')
  @UseGuards(OptionalAuthGuard)
  async findOneById(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('countryCode') countryCode?: string,
  ) {
    const storeId = resolveMongoIdFromPublicParam(id) ?? id;
    const store = await this._storeService.findOneById(storeId, {
      requireMobileVisibility: true,
      clientPlatform: clientPlatformFromRequest(req),
      countryCode,
      user: req.user as UserModel | undefined,
    });
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    return store;
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
    @Query('storeId') storeId?: string,
  ) {
    return this._storeService.updateVendorShippingZones(
      req.user as UserModel,
      body,
      storeId,
    );
  }

  /** Horaires d’ouverture et fuseau horaire (boutique ACTIVE ou dossier en cours). */
  @Patch('vendor/working-hours')
  @UseGuards(JwtGuard)
  async patchVendorWorkingHours(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchVendorWorkingHoursDto,
    @Query('storeId') storeId?: string,
  ) {
    return this._storeService.updateVendorWorkingHours(
      req.user as UserModel,
      body,
      storeId,
    );
  }

  @Get('vendor/delivery-drivers')
  @UseGuards(JwtGuard)
  async listVendorDeliveryDrivers(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
  ) {
    return this._storeDeliveryDrivers.listForVendor(
      req.user as UserModel,
      storeId,
    );
  }

  @Post('vendor/delivery-drivers/invite')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async inviteVendorDeliveryDriver(
    @Req() req: Request,
    @Body() body: InviteStoreDeliveryDriverDto,
    @Query('storeId') storeId?: string,
  ) {
    return this._storeDeliveryDrivers.inviteByEmail(
      req.user as UserModel,
      body.email,
      storeId,
    );
  }

  @Post('vendor/delivery-drivers/:membershipId/resend')
  @UseGuards(JwtGuard)
  async resendVendorDeliveryDriverInvite(
    @Req() req: Request,
    @Param('membershipId') membershipId: string,
  ) {
    return this._storeDeliveryDrivers.resendInvite(
      req.user as UserModel,
      membershipId,
    );
  }

  @Delete('vendor/delivery-drivers/:membershipId')
  @UseGuards(JwtGuard)
  async revokeVendorDeliveryDriver(
    @Req() req: Request,
    @Param('membershipId') membershipId: string,
  ) {
    return this._storeDeliveryDrivers.revokeMembership(
      req.user as UserModel,
      membershipId,
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
    const max = await this._mediasService.getMaxFileSizeBytes();
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
        limits: { fileSize: MULTER_HARD_MAX_BYTES },
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
    const maxBytes = await this._mediasService.getMaxFileSizeBytes();
    const imageFile = multerFileFromVendorProductBase64(
      body.imageBase64,
      body.imageFilename,
      'image',
      maxBytes,
    );
    const galleryFiles = galleryMulterFilesFromJson(
      body.galleryBase64,
      body.galleryFilenames,
      maxBytes,
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
    const maxBytes = await this._mediasService.getMaxFileSizeBytes();
    const imageFile = multerFileFromVendorProductBase64(
      body.imageBase64,
      body.imageFilename,
      'image',
      maxBytes,
    );
    const galleryFiles = galleryMulterFilesFromJson(
      body.galleryBase64,
      body.galleryFilenames,
      maxBytes,
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

  @Get(':id/subscribe-status')
  @UseGuards(JwtGuard)
  async subscribeStatus(@Param('id') id: string, @Req() req: Request) {
    const subscribed = await this._storeSubscribers.isSubscribed(
      id,
      req.user as UserModel,
    );
    return { subscribed };
  }

  @Post(':id/subscribe')
  @UseGuards(JwtGuard)
  async subscribeToStore(@Param('id') id: string, @Req() req: Request) {
    return this._storeSubscribers.subscribe(id, req.user as UserModel);
  }

  @Delete(':id/subscribe')
  @UseGuards(JwtGuard)
  async unsubscribeFromStore(@Param('id') id: string, @Req() req: Request) {
    return this._storeSubscribers.unsubscribe(id, req.user as UserModel);
  }

  @Get(':id/subscribers/stats')
  @UseGuards(JwtGuard)
  async storeSubscriberStats(@Param('id') id: string, @Req() req: Request) {
    return this._storeSubscribers.statsForStore(id, req.user as UserModel);
  }

  @Get(':id/subscribers')
  @UseGuards(JwtGuard)
  async storeSubscribers(@Param('id') id: string, @Req() req: Request) {
    return this._storeSubscribers.listForStore(id, req.user as UserModel);
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
