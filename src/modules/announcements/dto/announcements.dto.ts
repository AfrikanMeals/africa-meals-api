import { SearchContent } from '@modules/search/dto/search.dto';
import { AnnouncementNavigationTypeEnum } from '@schemas/announcement.schema';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class AnnouncementConfigStyleDto {
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  colors: string[];
}

class AnnouncementConfigQueryDto {
  @IsNotEmpty()
  @IsEnum(SearchContent)
  searchContent: SearchContent;

  @IsOptional()
  storeId?: string;

  @IsOptional()
  categoryId?: string;

  @IsOptional()
  producId?: string;
}

class AnnouncementConfigDto {
  @IsNotEmpty()
  @IsEnum(AnnouncementNavigationTypeEnum)
  navigationType: AnnouncementNavigationTypeEnum;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AnnouncementConfigQueryDto)
  query: AnnouncementConfigQueryDto;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AnnouncementConfigStyleDto)
  style: AnnouncementConfigStyleDto;

  @IsNotEmpty()
  @ValidateIf(
    (o) => o.navigationType === AnnouncementNavigationTypeEnum.EXTERNAL,
  )
  url: string;
}

export class CreateAnnouncementDto {
  @IsBoolean()
  @IsNotEmpty()
  isActive: boolean;

  @IsNotEmpty()
  text: string;

  @IsNotEmpty()
  actionText: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AnnouncementConfigDto)
  config: AnnouncementConfigDto;
}
