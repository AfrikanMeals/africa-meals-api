import { AdModerationStatusEnum } from '@schemas/ad.schema';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum CatalogModerationKindEnum {
  FOOD = 'FOOD',
  DRINK = 'DRINK',
  ITEM = 'ITEM',
}

export class ListCatalogModerationQueryDto {
  @IsOptional()
  @IsEnum(CatalogModerationKindEnum)
  kind?: CatalogModerationKindEnum;

  @IsOptional()
  @IsEnum(AdModerationStatusEnum)
  status?: AdModerationStatusEnum;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
