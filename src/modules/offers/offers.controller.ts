import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { FilterOffersDto } from './dto/offers.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth('bearer')
@Controller('offers')
export class OffersController {
  @Inject(OffersService) private readonly _offersService: OffersService;

  @Get('')
  @UseGuards(JwtGuard)
  async filter(
    @Req() req: Request,
    @Query(ValidationPipe) args: FilterOffersDto,
  ) {
    return this._offersService.filter(args, req.user as UserModel);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  async findOneById(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<any> {
    return this._offersService.findOne(id, req.user as UserModel);
  }
}
