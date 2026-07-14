import { SearchContent } from '@modules/search/dto/search.dto';
import {
  AnnouncementAudienceTypeEnum,
  AnnouncementPlacementEnum,
} from '@schemas/announcement.constants';
import { AnnouncementNavigationTypeEnum } from '@schemas/announcement.schema';
import { StoreAdActionTypeEnum } from '@schemas/ad.schema';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const ANNOUNCEMENT_HEX_COLOR_RE =
  /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

class AnnouncementConfigStyleDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  colors?: string[];
}

class AnnouncementConfigQueryDto {
  @IsOptional()
  @IsEnum(SearchContent)
  searchContent?: SearchContent;

  @IsOptional()
  storeId?: string;

  @IsOptional()
  categoryId?: string;

  @IsOptional()
  producId?: string;
}

class AnnouncementConfigDto {
  @IsOptional()
  @IsEnum(AnnouncementNavigationTypeEnum)
  navigationType?: AnnouncementNavigationTypeEnum;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementConfigQueryDto)
  query?: AnnouncementConfigQueryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementConfigStyleDto)
  style?: AnnouncementConfigStyleDto;

  @IsOptional()
  @ValidateIf(
    (o) => o.navigationType === AnnouncementNavigationTypeEnum.EXTERNAL,
  )
  url?: string;
}

export class AnnouncementBaseDto {
  @IsBoolean()
  isActive: boolean;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementConfigDto)
  config?: AnnouncementConfigDto;

  @IsOptional()
  @Type(() => Number)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsEnum(AnnouncementAudienceTypeEnum)
  audienceType?: AnnouncementAudienceTypeEnum;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  audienceUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(AnnouncementPlacementEnum, { each: true })
  placements?: AnnouncementPlacementEnum[];

  @IsOptional()
  @IsEnum(StoreAdActionTypeEnum)
  actionType?: StoreAdActionTypeEnum;

  @IsOptional()
  @IsString()
  actionTarget?: string;

  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsBoolean()
  dismissible?: boolean;

  /** URL déjà uploadée (ex. via POST /announcements/image-json). `null` = retirer. */
  @IsOptional()
  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  @IsString()
  @MaxLength(4096)
  pictureUrl?: string | null;

  /** Fond bandeau (#RGB / #RRGGBB / #RRGGBBAA). */
  @IsOptional()
  @IsString()
  @MaxLength(9)
  @ValidateIf((_, value) => String(value ?? '').trim() !== '')
  @Matches(ANNOUNCEMENT_HEX_COLOR_RE, { message: 'invalid_background_color' })
  backgroundColor?: string;

  /** Texte bandeau (#RGB / #RRGGBB / #RRGGBBAA). */
  @IsOptional()
  @IsString()
  @MaxLength(9)
  @ValidateIf((_, value) => String(value ?? '').trim() !== '')
  @Matches(ANNOUNCEMENT_HEX_COLOR_RE, { message: 'invalid_text_color' })
  textColor?: string;
}

export class CreateAnnouncementDto extends AnnouncementBaseDto {}

export class UpdateAnnouncementDto extends AnnouncementBaseDto {}

export class ListAnnouncementsQueryDto {
  @IsOptional()
  @IsEnum(AnnouncementPlacementEnum)
  placement?: AnnouncementPlacementEnum;

  @IsOptional()
  @IsString()
  regionCode?: string;
}
