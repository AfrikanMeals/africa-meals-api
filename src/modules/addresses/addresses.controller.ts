import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, SearchAddressDto } from './dto/addresses.dto';

@ApiTags('addresses')
@ApiBearerAuth('bearer')
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
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(ValidationPipe) args: CreateAddressDto,
  ) {
    return this._addressesService.update(id, args, req.user as UserModel);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  async delete(@Req() req: Request, @Param('id') id: string) {
    await this._addressesService.delete(id, req.user as UserModel);
  }

  @Patch(':id/default')
  @UseGuards(JwtGuard)
  async setDefault(@Req() req: Request, @Param('id') id: string) {
    return this._addressesService.setDefault(id, req.user as UserModel);
  }
}
