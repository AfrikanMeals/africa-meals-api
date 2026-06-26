import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class TriggerBackupDto {
  @ApiProperty({ enum: ['incremental', 'full'] })
  @IsIn(['incremental', 'full'])
  type: 'incremental' | 'full';
}
