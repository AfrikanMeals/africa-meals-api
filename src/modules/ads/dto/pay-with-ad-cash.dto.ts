import { ApiProperty } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class PayWithAdCashDto {
  @ApiProperty({
    required: false,
    description: 'Boutique cible ; sinon toutes les boutiques du vendeur.',
  })
  @IsOptional()
  @IsString()
  @Trim()
  @IsMongoId()
  storeId?: string;
}
