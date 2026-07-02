import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  UserNotificationPreferencesDocument,
  UserNotificationPreferencesModel,
} from '@schemas/user-notification-preferences.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { UpdateUserNotificationPreferencesDto } from './dto/update-user-notification-preferences.dto';

export type UserNotificationPreferencesResponse = {
  emailRecommendations: boolean;
  emailStoreDigest: boolean;
  emailMarketing: boolean;
  unsubscribedAt: string | null;
  pausedUntil: string | null;
};

@Injectable()
export class UserNotificationPreferencesService {
  constructor(
    @InjectModel(UserNotificationPreferencesModel.name)
    private readonly prefsModel: Model<UserNotificationPreferencesDocument>,
  ) {}

  private toResponse(
    doc: UserNotificationPreferencesModel,
  ): UserNotificationPreferencesResponse {
    return {
      emailRecommendations: doc.emailRecommendations === true,
      emailStoreDigest: doc.emailStoreDigest === true,
      emailMarketing: doc.emailMarketing === true,
      unsubscribedAt: doc.unsubscribedAt?.toISOString?.() ?? null,
      pausedUntil: doc.pausedUntil?.toISOString?.() ?? null,
    };
  }

  async getOrCreate(userId: string): Promise<UserNotificationPreferencesResponse> {
    const doc = await this.prefsModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $setOnInsert: { userId: new Types.ObjectId(userId) } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toResponse(doc);
  }

  async isEmailRecoEligible(userId: string): Promise<boolean> {
    const prefs = await this.getOrCreate(userId);
    if (prefs.unsubscribedAt) return false;
    if (prefs.pausedUntil && new Date(prefs.pausedUntil) > new Date()) {
      return false;
    }
    return prefs.emailRecommendations || prefs.emailStoreDigest;
  }

  async updateForUser(
    user: UserModel,
    dto: UpdateUserNotificationPreferencesDto,
  ): Promise<UserNotificationPreferencesResponse> {
    const userId = String(user._id);
    const patch: Record<string, unknown> = { ...dto };
    if (
      dto.emailRecommendations === false &&
      dto.emailStoreDigest === false &&
      dto.emailMarketing === false
    ) {
      patch.unsubscribedAt = new Date();
    } else if (
      dto.emailRecommendations === true ||
      dto.emailStoreDigest === true ||
      dto.emailMarketing === true
    ) {
      patch.unsubscribedAt = null;
    }
    const doc = await this.prefsModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $set: patch, $setOnInsert: { userId: new Types.ObjectId(userId) } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toResponse(doc);
  }

  async recordNonOpen(userId: string, pauseCount: number, pauseDays: number) {
    const doc = await this.prefsModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (!doc) return;
    const next = (doc.consecutiveNonOpens ?? 0) + 1;
    const patch: Record<string, unknown> = { consecutiveNonOpens: next };
    if (next >= pauseCount) {
      patch.pausedUntil = new Date(Date.now() + pauseDays * 24 * 60 * 60 * 1000);
      patch.consecutiveNonOpens = 0;
    }
    await this.prefsModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      { $set: patch },
    );
  }

  async recordOpen(userId: string) {
    await this.prefsModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      { $set: { consecutiveNonOpens: 0 } },
    );
  }

  async unsubscribeByToken(userId: string) {
    await this.prefsModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          emailRecommendations: false,
          emailStoreDigest: false,
          emailMarketing: false,
          unsubscribedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
