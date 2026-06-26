import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserUsageSourceEnum } from '@schemas/user-usage-session.schema';

export class RecordUsageSessionDto {
  @ApiProperty({ enum: ['start', 'heartbeat', 'end'] })
  @IsIn(['start', 'heartbeat', 'end'])
  action!: 'start' | 'heartbeat' | 'end';

  @ApiProperty({ enum: UserUsageSourceEnum })
  @IsIn([UserUsageSourceEnum.MOBILE, UserUsageSourceEnum.ADMIN])
  source!: UserUsageSourceEnum;

  @ApiProperty({ example: 'sess_abc123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId!: string;
}
