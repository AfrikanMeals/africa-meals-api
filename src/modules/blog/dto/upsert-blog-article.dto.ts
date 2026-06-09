import { AppPolicySectionDto } from '@modules/app-policies/dto/upsert-app-policy.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpsertBlogArticleDto {
  @ApiProperty({ example: 'lancer-restaurant-wise-eat' })
  @IsString()
  @MaxLength(64)
  slug: string;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @ApiProperty({ example: 'actualites' })
  @IsString()
  @MaxLength(64)
  groupSlug: string;

  @ApiProperty({ example: 'Comment lancer votre restaurant sur Wise Eat' })
  @IsString()
  @MaxLength(300)
  title: string;

  @ApiPropertyOptional({ example: 'Guide pas à pas pour les nouveaux partenaires.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/blog/hero.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  featuredImageUrl?: string;

  @ApiPropertyOptional({ type: [AppPolicySectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AppPolicySectionDto)
  sections?: AppPolicySectionDto[];

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
