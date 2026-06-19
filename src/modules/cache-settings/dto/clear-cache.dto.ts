import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ClearCacheDto {
  @ApiProperty({
    enum: ['public-catalog', 'all'],
    description:
      'public-catalog : catalogue client (prix, menus, recherche). all : inclut favoris et catégories.',
  })
  @IsIn(['public-catalog', 'all'])
  scope: 'public-catalog' | 'all';
}
