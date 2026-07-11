import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateGraphdbSettingsDto {
  @ApiProperty({
    description:
      'Kill-switch global Neo4j (driver / health / workers). false = zéro connexion.',
    example: false,
  })
  @IsBoolean()
  neo4jEnabled: boolean;

  @ApiProperty({
    description:
      'Lectures recommandations via Neo4j. No-op si neo4jEnabled=false.',
    example: false,
  })
  @IsBoolean()
  recoGraphEnabled: boolean;

  @ApiProperty({
    description:
      'Écritures sync outbox / BullMQ → Neo4j. No-op si neo4jEnabled=false.',
    example: false,
  })
  @IsBoolean()
  graphSyncEnabled: boolean;
}
