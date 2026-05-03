import { AdEventTypeEnum } from '@schemas/ad-event.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class TrackAdEventDto {
  @ApiProperty({ description: 'ID Mongo de la bannière' })
  @IsMongoId()
  adId: string;

  @ApiProperty({ enum: AdEventTypeEnum })
  @IsEnum(AdEventTypeEnum)
  eventType: AdEventTypeEnum;

  @ApiPropertyOptional({
    description:
      'UUID ou identifiant persistant côté client (invités / complément au compte).',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientInstallId?: string;
}
