import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, SearchAddressDto } from './dto/addresses.dto';

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

  @Put(':id')
  @UseGuards(JwtGuard)
  async create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ValidationPipe) args: CreateAddressDto,
  ) {
    return this._addressesService.update(id, args, req.user as UserModel);
  }
}
