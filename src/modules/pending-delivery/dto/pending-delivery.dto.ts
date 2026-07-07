import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PendingDeliveriesQueryDto {
  @ApiPropertyOptional({ description: 'Filtre boutique (obligatoire pour vendeur).' })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ClosePendingDeliveryDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class SubmitCustomerAbsentDeliveryDto {
  @ApiProperty({ example: 45.5017 })
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  courierLat: number;

  @ApiProperty({ example: -73.5673 })
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  courierLng: number;
}

export class ProofPhotoJsonDto {
  @ApiProperty({
    description: 'Photo en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  fileBase64: string;

  @ApiProperty({ example: 'proof.jpg' })
  @IsNotEmpty()
  @IsString()
  filename: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimeType?: string;
}

/** JSON + base64 — fiable sur Fastify / Firebase / proxys où multipart échoue. */
export class SubmitCustomerAbsentDeliveryJsonDto {
  @ApiProperty({ example: 45.5017 })
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  courierLat: number;

  @ApiProperty({ example: -73.5673 })
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  courierLng: number;

  @ApiProperty({ type: [ProofPhotoJsonDto], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ProofPhotoJsonDto)
  proofPhotos: ProofPhotoJsonDto[];
}

export class CustomerPendingDeliveryActionDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ReviewPendingDeliveryDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsString()
  decision: 'approve' | 'reject';

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class PreviewCustomerAbsentDeliveryDto {
  @ApiProperty({ example: 45.5017 })
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  courierLat: number;

  @ApiProperty({ example: -73.5673 })
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  courierLng: number;
}
