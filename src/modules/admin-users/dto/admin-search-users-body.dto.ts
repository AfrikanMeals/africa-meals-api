import { UserTypeEnum } from '@schemas/user.schema';
import { Allow, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

/** Filtres optionnels dans le corps de `POST /admin/users/search` (compat admin legacy). */
export class AdminSearchUsersBodyDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserTypeEnum)
  type?: UserTypeEnum;

  @IsOptional()
  @IsIn(['active', 'disabled', 'deletion_pending'])
  status?: 'active' | 'disabled' | 'deletion_pending';

  /** Résidus client admin legacy — ignorés, ne doivent pas provoquer de 400. */
  @Allow()
  @IsOptional()
  below?: unknown;

  @Allow()
  @IsOptional()
  isDefault?: unknown;
}
