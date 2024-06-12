import { Trim } from 'class-sanitizer';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export enum SortBy {
  PRICE = 'price',
  RATING = 'rating',
  NAME = 'name',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum SearchContent {
  STORES = 'stores',
  PRODUCTS = 'products',
}

export class SearchDto {
  @IsNotEmpty()
  @IsArray()
  @Transform(({ value }) =>
    value
      ?.trim()
      .split(',')
      ?.map((i) => i.trim()),
  )
  @IsEnum(SearchContent, { each: true })
  searchContent: SearchContent[];

  @IsOptional()
  @Trim()
  query?: string;

  @IsOptional()
  @Trim()
  storeId?: string;

  @IsOptional()
  @Trim()
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? +value : undefined))
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? +value : undefined))
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsEnum(SortBy)
  sortBy?: SortBy;

  @IsOptional()
  @IsEnum(SortOrder)
  sortDirection?: SortOrder;

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  skip?: number;
}

export class SearchResultDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
