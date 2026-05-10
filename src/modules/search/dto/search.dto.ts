import { Trim } from 'class-sanitizer';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export enum SortBy {
  PRICE = 'price',
  RATING = 'rating',
  NAME = 'name',
  CREATED_AT = 'createdAt',
  /** Distance boutique ↔ client (km), nécessite latitude + longitude. */
  DISTANCE = 'distance',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum SearchContent {
  STORES = 'stores',
  PRODUCTS = 'products',
  OFFERS = 'offers',
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
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  @IsNumber()
  @Min(1)
  take?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  @IsNumber()
  @Min(0)
  skip?: number;

  /** Latitude client (degrés). Avec [longitude], active filtre distance + tri par défaut. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  /** Longitude client (degrés). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  /** Rayon max en km (défaut 30 si lat/lng fournis). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
  @IsNumber()
  @Min(1)
  @Max(100)
  maxDistanceKm?: number;
}

export class SearchResultDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
