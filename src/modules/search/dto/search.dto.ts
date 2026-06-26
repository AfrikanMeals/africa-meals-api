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
import {
  normalizeSearchContentQuery,
  parseOptionalQueryNumber,
  trimOptionalQueryString,
} from './search-query.util';
import { FieldSelectionQueryDto } from '@common/field-selection/field-selection-query.dto';

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
  DRINKS = 'drinks',
  OFFERS = 'offers',
}

export class SearchDto extends FieldSelectionQueryDto {
  @IsNotEmpty()
  @IsArray()
  @Transform(({ value }) => normalizeSearchContentQuery(value))
  @IsEnum(SearchContent, { each: true })
  searchContent: SearchContent[];

  @IsOptional()
  @Transform(({ value }) => trimOptionalQueryString(value))
  query?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalQueryString(value))
  storeId?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalQueryString(value))
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
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
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(1)
  take?: number;

  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(0)
  skip?: number;

  /** Latitude client (degrés). Avec [longitude], active filtre distance + tri par défaut. */
  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  /** Longitude client (degrés). */
  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  /** Rayon max en km (défaut 30 si lat/lng fournis). */
  @IsOptional()
  @Transform(({ value }) => parseOptionalQueryNumber(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  maxDistanceKm?: number;

  /** Pays d’utilisation ISO2 (sinon profil JWT ou région primaire). */
  @IsOptional()
  @Transform(({ value }) => {
    const s = trimOptionalQueryString(value);
    return s ? s.toUpperCase() : s;
  })
  countryCode?: string;
}

export class SearchResultDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
