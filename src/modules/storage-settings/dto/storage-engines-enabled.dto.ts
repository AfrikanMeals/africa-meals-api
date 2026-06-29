import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class StorageEnginesEnabledDto {
  @ApiProperty({ description: 'Firebase Storage activé' })
  @IsBoolean()
  firebase: boolean;

  @ApiProperty({ description: 'Google Cloud Storage activé' })
  @IsBoolean()
  gcs: boolean;

  @ApiProperty({ description: 'Amazon S3 activé' })
  @IsBoolean()
  s3: boolean;

  @ApiProperty({ description: 'MinIO activé' })
  @IsBoolean()
  minio: boolean;

  @ApiProperty({ description: 'Cloudflare R2 activé' })
  @IsBoolean()
  r2: boolean;
}
