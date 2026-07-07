import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
