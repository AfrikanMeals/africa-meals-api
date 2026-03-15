import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('default')
@Controller('medias')
export class MediasController {}
