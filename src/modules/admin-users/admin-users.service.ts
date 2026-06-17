import { AuthService } from '@modules/auth/auth.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { buildCaseInsensitiveExactRegex } from '@common/mongo/escape-regex.util';
import { FilterQuery, Model, Types } from 'mongoose';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminSetUserDisabledDto } from './dto/admin-set-user-disabled.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';

export type AdminUserRow = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  type: UserTypeEnum;
  appCountryCode: string | null;
  emailVerified: boolean;
  disabled: boolean;
  accountDisabledAt: string | null;
  deletionPending: boolean;
  accountDeletionRequestedAt: string | null;
  accountDeletionScheduledFor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return null;
}

function serializeUser(doc: Record<string, unknown>): AdminUserRow {
  const disabledAt = doc.accountDisabledAt;
  const deletionRequestedAt = doc.accountDeletionRequestedAt;
  const deletionScheduledFor = doc.accountDeletionScheduledFor;
  return {
    id: String(doc._id ?? ''),
    fullName: String(doc.fullName ?? ''),
    email: String(doc.email ?? ''),
    phoneNumber:
      typeof doc.phoneNumber === 'string' && doc.phoneNumber.trim()
        ? doc.phoneNumber.trim()
        : null,
    type: (doc.type as UserTypeEnum) ?? UserTypeEnum.USER,
    appCountryCode:
      typeof doc.appCountryCode === 'string' ? doc.appCountryCode : null,
    emailVerified: doc.emailVerifiedAt instanceof Date,
    disabled: disabledAt instanceof Date,
    accountDisabledAt: toIso(disabledAt),
    deletionPending:
      deletionRequestedAt instanceof Date && deletionScheduledFor instanceof Date,
    accountDeletionRequestedAt: toIso(deletionRequestedAt),
    accountDeletionScheduledFor: toIso(deletionScheduledFor),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly storeAccess: StoreAccessService,
    private readonly authService: AuthService,
    private readonly supportedCountries: SupportedCountriesService,
  ) {}

  private async assertAdmin(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private assertNotSelf(actor: UserModel, targetUserId: string): void {
    if (String(actor._id) === String(targetUserId)) {
      throw new BadRequestException('cannot_modify_own_account_here');
    }
  }

  async listUsers(
    actor: UserModel,
    query: AdminListUsersQueryDto,
  ): Promise<{
    items: AdminUserRow[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    await this.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const filter: FilterQuery<UserModel> = {};

    if (query.type) {
      filter.type = query.type;
    }

    const search = query.search?.trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: escaped, $options: 'i' } },
        { fullName: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (query.status === 'disabled') {
      filter.accountDisabledAt = { $ne: null };
    } else if (query.status === 'deletion_pending') {
      filter.accountDeletionRequestedAt = { $ne: null };
      filter.accountDeletionScheduledFor = { $ne: null };
    } else if (query.status === 'active') {
      filter.accountDisabledAt = null;
    }

    const [total, rows] = await Promise.all([
      this.userModel.countDocuments(filter).exec(),
      this.userModel
        .find(filter)
        .select(
          'fullName email phoneNumber type appCountryCode emailVerifiedAt accountDisabledAt accountDeletionRequestedAt accountDeletionScheduledFor createdAt updatedAt',
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    return {
      items: rows.map((row) => serializeUser(row as Record<string, unknown>)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getUser(actor: UserModel, userId: string): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    const id = userId.trim();
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('invalid_user_id');
    }
    const row = await this.userModel
      .findById(id)
      .select(
        'fullName email phoneNumber type appCountryCode emailVerifiedAt accountDisabledAt accountDeletionRequestedAt accountDeletionScheduledFor createdAt updatedAt',
      )
      .lean()
      .exec();
    if (!row) throw new NotFoundException('user_not_found');
    return serializeUser(row as Record<string, unknown>);
  }

  async updateUser(
    actor: UserModel,
    userId: string,
    dto: AdminUpdateUserDto,
  ): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    this.assertNotSelf(actor, userId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('invalid_user_id');
    }

    const update: Partial<UserModel> = {};
    if (dto.fullName != null) update.fullName = dto.fullName.trim();
    if (dto.phoneNumber != null) update.phoneNumber = dto.phoneNumber.trim();
    if (dto.type != null) update.type = dto.type;
    if (dto.appCountryCode != null) {
      const code = dto.appCountryCode.trim().toUpperCase();
      if (!(await this.supportedCountries.isActiveCode(code))) {
        throw new BadRequestException('unsupported_country_code');
      }
      update.appCountryCode = code;
    }
    if (dto.email != null) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.userModel
        .findOne({
          email: buildCaseInsensitiveExactRegex(email),
          _id: { $ne: userId },
        })
        .select('_id')
        .lean()
        .exec();
      if (existing) throw new ConflictException('email_already_used');
      update.email = email;
    }

    if (Object.keys(update).length === 0) {
      return this.getUser(actor, userId);
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, { $set: update }, { new: true })
      .select(
        'fullName email phoneNumber type appCountryCode emailVerifiedAt accountDisabledAt accountDeletionRequestedAt accountDeletionScheduledFor createdAt updatedAt',
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('user_not_found');
    return serializeUser(updated as Record<string, unknown>);
  }

  async setUserDisabled(
    actor: UserModel,
    userId: string,
    dto: AdminSetUserDisabledDto,
  ): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    this.assertNotSelf(actor, userId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('invalid_user_id');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          $set: {
            accountDisabledAt: dto.disabled === true ? new Date() : null,
          },
        },
        { new: true },
      )
      .select(
        'fullName email phoneNumber type appCountryCode emailVerifiedAt accountDisabledAt accountDeletionRequestedAt accountDeletionScheduledFor createdAt updatedAt',
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('user_not_found');
    return serializeUser(updated as Record<string, unknown>);
  }

  async deleteUser(
    actor: UserModel,
    userId: string,
  ): Promise<{ message: string; deleted: boolean }> {
    await this.assertAdmin(actor);
    this.assertNotSelf(actor, userId);
    return this.authService.adminDeleteAccountNow(
      String(actor._id),
      userId.trim(),
    );
  }

  async cancelDeletionRequest(
    actor: UserModel,
    userId: string,
  ): Promise<AdminUserRow> {
    await this.assertAdmin(actor);
    await this.authService.adminCancelAccountDeletion(
      String(actor._id),
      userId.trim(),
    );
    return this.getUser(actor, userId);
  }
}
