import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AddressesService } from './addresses.service';
import { SearchAddressDto } from './dto/addresses.dto';

@Controller('addresses')
export class AddressesController {
  @Inject(AddressesService)
  private readonly _addressesService: AddressesService;

  @Get('')
  @UseGuards(JwtGuard)
  async search(
    @Req() req: Request,
    @Query(ValidationPipe) args: SearchAddressDto,
  ) {
    return this._addressesService.search(args, req.user as UserModel);
  }

  // @Post('')
  // @UseGuards(JwtGuard)
  // async create(
  //   @Req() req: Request,
  //   @Body(ValidationPipe) args: CreateAddressDto,
  // ) {
  //   return this._addressesService.create(args, req.user as UserModel);
  // }
}
