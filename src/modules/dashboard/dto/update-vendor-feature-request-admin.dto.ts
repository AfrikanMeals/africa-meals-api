import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { VendorFeatureRequestStatusEnum } from '@schemas/vendor-feature-request.schema';

export class UpdateVendorFeatureRequestAdminDto {
  @ApiProperty({ enum: VendorFeatureRequestStatusEnum })
  @IsEnum(VendorFeatureRequestStatusEnum)
  status: VendorFeatureRequestStatusEnum;
}
