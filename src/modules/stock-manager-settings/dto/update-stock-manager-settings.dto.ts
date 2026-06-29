import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateStockManagerSettingsDto {
  @ApiPropertyOptional({
    description:
      'Active la gestion stock ingrédients (menu catalogue + API stock-items).',
  })
  @IsOptional()
  @IsBoolean()
  ingredientStockManagementEnabled?: boolean;
}
