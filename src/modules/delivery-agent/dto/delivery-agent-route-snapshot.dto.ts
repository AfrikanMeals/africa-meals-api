import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class DeliveryAgentRouteSnapshotDto {
  @ApiProperty({
    description: 'Polyline Google Encoded (precision 5) calculée par le livreur',
    example: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(100_000)
  encodedPolyline!: string;

  @ApiPropertyOptional({
    enum: ['google'],
    default: 'google',
  })
  @IsOptional()
  @IsIn(['google'])
  format?: 'google';

  @ApiPropertyOptional({
    enum: ['to_store', 'to_customer', 'full'],
    description: 'Jambe courante ou trajet complet agent→boutique→client',
  })
  @IsOptional()
  @IsIn(['to_store', 'to_customer', 'full'])
  leg?: 'to_store' | 'to_customer' | 'full';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  distanceMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(172_800)
  durationSeconds?: number;
}
