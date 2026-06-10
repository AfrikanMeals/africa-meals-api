import { ApiPropertyOptional } from '@nestjs/swagger';
import { NewsletterSubscriberStatusEnum } from '@schemas/newsletter-subscriber.schema';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminNewsletterSubscribersQueryDto {
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

  @ApiPropertyOptional({ enum: NewsletterSubscriberStatusEnum })
  @IsOptional()
  @IsEnum(NewsletterSubscriberStatusEnum)
  status?: NewsletterSubscriberStatusEnum;

  @ApiPropertyOptional({ description: 'Recherche partielle sur l’e-mail' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional()
  @IsString()
  to?: string;
}
