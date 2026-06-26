import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class RestoreBackupDto {
  @ApiProperty({ description: 'ID du run de sauvegarde à restaurer.' })
  @IsMongoId()
  backupRunId: string;

  @ApiProperty({
    description: 'Phrase de confirmation : RESTAURER_AFRIKAMEALS',
  })
  @IsString()
  @IsNotEmpty()
  confirmPhrase: string;
}
