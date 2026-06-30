import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Image annonce : JSON + base64 — fiable quand multipart est tronqué (Firebase / CF / proxys). */
export class AnnouncementImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ example: 'annonce.webp' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;
}
