import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('default')
@Controller('ratings')
export class RatingsController {}
