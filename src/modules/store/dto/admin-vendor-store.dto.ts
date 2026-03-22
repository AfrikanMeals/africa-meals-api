import { ApiProperty } from '@nestjs/swagger';
import { StoreStatusEnum } from '@schemas/store.schema';
import { IsIn } from 'class-validator';

/** Changement de statut boutique par un administrateur (approbation / suspension). */
export class AdminVendorStoreStatusDto {
  @ApiProperty({
    enum: [StoreStatusEnum.ACTIVE, StoreStatusEnum.INACTIVE],
    example: StoreStatusEnum.ACTIVE,
  })
  @IsIn([StoreStatusEnum.ACTIVE, StoreStatusEnum.INACTIVE])
  status: StoreStatusEnum.ACTIVE | StoreStatusEnum.INACTIVE;
}
