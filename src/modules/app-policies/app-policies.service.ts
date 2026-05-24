import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AppPolicyDocument,
  AppPolicyModel,
  AppPolicySectionModel,
} from '@schemas/app-policy.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { MediasService } from '@modules/medias/medias.service';
import { UpsertAppPolicyDto } from './dto/upsert-app-policy.dto';
import { PolicySectionImageJsonDto } from './dto/policy-section-image.dto';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeLocale(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 8) || 'fr';
}

function serializePolicy(doc: AppPolicyDocument) {
  return {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    title: doc.title,
    description: doc.description ?? '',
    sections: (doc.sections ?? []).map((s: AppPolicySectionModel) => ({
      title: s.title ?? '',
      imageUrl: s.imageUrl?.trim() || undefined,
      htmlContent: s.htmlContent ?? '',
    })),
    isPublished: Boolean(doc.isPublished),
    updatedAt: doc.updatedAt?.toISOString?.() ?? null,
    createdAt: doc.createdAt?.toISOString?.() ?? null,
  };
}

@Injectable()
export class AppPoliciesService {
  constructor(
    @InjectModel(AppPolicyModel.name)
    private readonly _policies: Model<AppPolicyDocument>,
    private readonly _mediasService: MediasService,
  ) {}

  async listForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._policies
      .find({})
      .sort({ slug: 1, locale: 1 })
      .exec();
    return docs.map(serializePolicy);
  }

  async getForAdmin(user: UserModel, slug: string, localeRaw: string) {
    assertAdmin(user);
    const locale = normalizeLocale(localeRaw);
    const doc = await this._policies.findOne({ slug, locale }).exec();
    if (!doc) {
      return {
        slug,
        locale,
        title: '',
        description: '',
        sections: [],
        isPublished: false,
        updatedAt: null,
        createdAt: null,
      };
    }
    return serializePolicy(doc);
  }

  async upsert(user: UserModel, dto: UpsertAppPolicyDto) {
    assertAdmin(user);
    const locale = normalizeLocale(dto.locale);
    const sections = (dto.sections ?? []).map((s) => ({
      title: s.title.trim(),
      imageUrl: s.imageUrl?.trim() || undefined,
      htmlContent: s.htmlContent ?? '',
    }));

    const doc = await this._policies
      .findOneAndUpdate(
        { slug: dto.slug, locale },
        {
          $set: {
            slug: dto.slug,
            locale,
            title: dto.title.trim(),
            description: dto.description?.trim() ?? '',
            sections,
            isPublished: Boolean(dto.isPublished),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!doc) {
      throw new BadRequestException('policy_save_failed');
    }
    return serializePolicy(doc);
  }

  async getPublishedPublic(slug: string, localeRaw?: string) {
    const locale = normalizeLocale(localeRaw ?? 'fr');
    let doc = await this._policies
      .findOne({ slug, locale, isPublished: true })
      .exec();
    if (!doc && locale !== 'fr') {
      doc = await this._policies
        .findOne({ slug, locale: 'fr', isPublished: true })
        .exec();
    }
    if (!doc) {
      throw new NotFoundException('policy_not_found');
    }
    return serializePolicy(doc);
  }

  async uploadSectionImage(
    user: UserModel,
    dto: PolicySectionImageJsonDto,
  ): Promise<{ url: string }> {
    assertAdmin(user);
    const raw = dto.imageBase64
      .replace(/\s/g, '')
      .replace(/^data:image\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_image');
    }
    const max = 5 * 1024 * 1024;
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (dto.filename || 'policy-section.jpg').trim() || 'policy-section.jpg';
    if (!/\.(jpe?g|png|webp)$/i.test(name)) {
      throw new BadRequestException('invalid_file_type');
    }
    const lower = name.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    const file = {
      buffer,
      originalname: name,
      mimetype: mime,
      size: buffer.length,
    } as Express.Multer.File;
    const url = await this._mediasService.upload(
      file,
      user,
      'legal/policies',
    );
    return { url };
  }
}
