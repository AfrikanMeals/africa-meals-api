import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ClearCacheDto {
  @ApiProperty({
    enum: ['public-catalog', 'all', 'everything'],
    description:
      'public-catalog : catalogue client. all : + favoris et catégories. everything : tout le cache applicatif connu (+ pricing panier).',
  })
  @IsIn(['public-catalog', 'all', 'everything'])
  scope: 'public-catalog' | 'all' | 'everything';
}
