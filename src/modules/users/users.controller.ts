import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  @Inject(UsersService)
  private readonly _usersService: UsersService;

  @Post('address')
  @UseGuards(JwtGuard)
  async createAddress(
    @Req() req: Request,
    @Body(ValidationPipe) args: CreateAddressDto,
  ) {
    return this._usersService.createAddress(args, req.user as UserModel);
  }
}
