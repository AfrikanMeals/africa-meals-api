import {
  CreateGiftCodeDto,
  PatchGiftCodeDto,
} from '@modules/gift-codes/dto/gift-code.dto';
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
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { GiftCodesService } from './gift-codes.service';

@ApiTags('gift-codes')
@ApiBearerAuth('bearer')
@Controller('gift-codes')
export class GiftCodesController {
  @Inject(GiftCodesService)
  private readonly _giftCodes: GiftCodesService;

  /** Catalogue client mobile (JWT). */
  @Get('public')
  @UseGuards(JwtGuard)
  async listPublic(@Req() req: Request) {
    const user = req.user as UserModel;
    const region =
      typeof req.query?.region === 'string' ? req.query.region : undefined;
    return this._giftCodes.listPublicForClient(user, region);
  }

  /** Liste des gift codes — administrateurs uniquement. */
  @Get()
  @UseGuards(JwtGuard)
  async list(@Req() req: Request) {
    return this._giftCodes.listForAdmin(req.user as UserModel);
  }

  @Post()
  @UseGuards(JwtGuard)
  async create(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: CreateGiftCodeDto,
  ) {
    return this._giftCodes.create(req.user as UserModel, body);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  async patch(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PatchGiftCodeDto,
  ) {
    return this._giftCodes.patch(req.user as UserModel, id, body);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async delete(@Param('id') id: string, @Req() req: Request) {
    await this._giftCodes.remove(req.user as UserModel, id);
  }
}
