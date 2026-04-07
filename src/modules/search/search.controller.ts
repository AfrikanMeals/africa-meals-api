import { OptionalAuthGuard } from '@modules/auth/guards/optional.auth.guard';
import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { SearchDto } from './dto/search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  @Inject(SearchService)
  private readonly _searchService: SearchService;

  @Get('')
  @UseGuards(OptionalAuthGuard)
  async filter(
    @Req() req: Request,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    args: SearchDto,
  ) {
    return this._searchService.filter(args, req.user as UserModel);
  }
}
