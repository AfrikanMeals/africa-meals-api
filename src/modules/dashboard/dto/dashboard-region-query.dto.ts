import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/** Filtre optionnel par région plateforme (ISO2, ex. CM, CA). */
export class DashboardRegionQueryDto {
  @ApiPropertyOptional({
    example: 'CM',
    description: 'Code pays ISO2 — limite aux boutiques de cette région.',
  })
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  region?: string;
}

export function normalizeDashboardRegionQuery(
  raw?: string,
): string | undefined {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}
