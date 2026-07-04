import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const APP_CHECK_TOKEN_APPS = ['android', 'ios', 'web'] as const;
export type AppCheckTokenApp = (typeof APP_CHECK_TOKEN_APPS)[number];

export class CreateAppCheckTokenDto {
  @ApiProperty({
    enum: APP_CHECK_TOKEN_APPS,
    description: 'Application Firebase cible (Android, iOS ou Web/Admin)',
  })
  @IsIn(APP_CHECK_TOKEN_APPS)
  app: AppCheckTokenApp;

  @ApiPropertyOptional({
    description: 'Durée de vie en heures (1–168, défaut 168 = 7 jours, max Firebase)',
    minimum: 1,
    maximum: 168,
    default: 168,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  ttlHours?: number;
}
