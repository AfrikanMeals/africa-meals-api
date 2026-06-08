import { ApiPropertyOptional } from '@nestjs/swagger';
import { VendorFeatureRequestStatusEnum } from '@schemas/vendor-feature-request.schema';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminVendorFeatureRequestsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @ApiPropertyOptional({ enum: VendorFeatureRequestStatusEnum })
  @IsOptional()
  @IsEnum(VendorFeatureRequestStatusEnum)
  status?: VendorFeatureRequestStatusEnum;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsString()
  to?: string;
}
