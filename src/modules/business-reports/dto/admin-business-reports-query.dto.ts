import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class AdminBusinessReportsQueryDto {
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

  @ApiPropertyOptional({ description: 'Filtrer par boutique' })
  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @ApiPropertyOptional({ description: 'true = archivés, false = actifs' })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  archived?: boolean;
}
