import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReplySiteContactRequestDto {
  @ApiProperty({ description: 'Corps de la réponse au client' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @ApiPropertyOptional({
    description: 'Objet de l’e-mail (défaut : Re: sujet du message initial)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;
}
