import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateVendorFeedbackDto {
  @ApiProperty({
    description: 'Note de satisfaction du vendeur (1 à 5)',
    example: 4,
    minimum: 1,
    maximum: 5,
  })
  @IsInt()
  @Min(1)
  rate: number;

  @ApiPropertyOptional({
    description: 'Commentaire texte libre du vendeur',
    example: 'Le dashboard est fluide, merci.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
