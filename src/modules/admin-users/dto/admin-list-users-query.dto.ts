import { FieldSelectionQueryDto } from '@common/field-selection/field-selection-query.dto';
import { UserTypeEnum } from '@schemas/user.schema';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const ADMIN_USER_SORT_FIELDS = [
  'createdAt',
  'fullName',
  'email',
  'updatedAt',
] as const;

export class AdminListUsersQueryDto extends FieldSelectionQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserTypeEnum)
  type?: UserTypeEnum;

  /** active | disabled | deletion_pending */
  @IsOptional()
  @IsIn(['active', 'disabled', 'deletion_pending'])
  status?: 'active' | 'disabled' | 'deletion_pending';

  /** Tri (alias legacy admin : `?field=createdAt&order=DESC`). */
  @IsOptional()
  @IsIn(ADMIN_USER_SORT_FIELDS)
  field?: (typeof ADMIN_USER_SORT_FIELDS)[number];

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}
