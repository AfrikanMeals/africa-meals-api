import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmDeliveryHandoffDto {
  @ApiProperty({
    description: 'Code retrait / livraison scanné ou saisi.',
    example: 'DFZZX8',
    minLength: 4,
    maxLength: 12,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  code!: string;
}

export class PreviewDeliveryHandoffDto {
  @ApiProperty({
    description: 'Code retrait / livraison scanné.',
    example: 'DFZZX8',
    minLength: 4,
    maxLength: 12,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  code!: string;

  @ApiPropertyOptional({
    description: 'Id commande extrait du QR (`oid`). Accélère la recherche.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderId?: string;
}
