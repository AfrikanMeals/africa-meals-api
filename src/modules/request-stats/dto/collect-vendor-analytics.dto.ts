import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class CollectVendorAnalyticsDto {
  @ApiProperty({
    description: 'Identifiant de la boutique associée à l’événement',
    example: '665f0f3796d5d5480f2a4f9c',
  })
  @IsMongoId()
  storeId: string;
}
