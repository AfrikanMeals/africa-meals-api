import { SearchContent } from '@modules/search/dto/search.dto';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreAdActionTypeEnum } from './ad.schema';
import {
  AnnouncementAudienceTypeEnum,
  AnnouncementPlacementEnum,
} from './announcement.constants';
import { ProductModel } from './product.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

export enum AnnouncementNavigationTypeEnum {
  INTERNAL = 'internal',
  EXTERNAL = 'external',
}

@Schema({
  timestamps: false,
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AnnouncementConfigQueryModel {
  @Prop({
    required: true,
    name: 'search_content',
    enum: SearchContent,
    default: SearchContent.PRODUCTS,
  })
  searchContent: SearchContent;

  @Prop({ required: false, name: 'store_id', default: null })
  storeId?: string;

  @Prop({ required: false, name: 'category_id', default: null })
  categoryId?: string;

  @Prop({ required: false, name: 'product_id', default: null })
  producId?: string;
}

@Schema({
  timestamps: false,
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AnnouncementConfigStyleModel {
  @Prop({
    required: true,
    name: 'colors',
    type: Array<MongooseSchema.Types.String>,
  })
  colors?: string[];
}

@Schema({
  timestamps: false,
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AnnouncementConfigModel {
  @Prop({
    required: true,
    name: 'navigation_type',
    enum: AnnouncementNavigationTypeEnum,
    default: AnnouncementNavigationTypeEnum.INTERNAL,
  })
  navigationType: AnnouncementNavigationTypeEnum;

  @Prop({
    required: true,
    name: 'query',
    type: AnnouncementConfigQueryModel,
  })
  query: AnnouncementConfigQueryModel;

  @Prop({ required: false, name: 'url', default: null })
  url?: string;

  @Prop({
    type: AnnouncementConfigStyleModel,
    validator: (value: { colors: string[] }) => {
      return value.colors.length > 0;
    },
  })
  style?: AnnouncementConfigStyleModel;
}

@Schema({
  timestamps: true,
  collection: 'announcements',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AnnouncementModel extends BaseSchema {
  @Prop({ default: false, name: 'is_active' })
  isActive: boolean;

  @Prop({ required: true, name: 'text' })
  text: string;

  /** Sous-titre (ligne secondaire). */
  @Prop({ required: false, name: 'subtitle', default: '' })
  subtitle?: string;

  @Prop({ required: true, name: 'action_text', default: 'En savoir plus' })
  actionText: string;

  @Prop({ required: false, name: 'picture_url' })
  pictureUrl?: string;

  @Prop({ default: 0, name: 'sort_order' })
  sortOrder: number;

  @Prop({ required: false, trim: true, uppercase: true })
  region?: string;

  @Prop({ required: false, name: 'valid_from' })
  validFrom?: Date;

  @Prop({ required: false, name: 'valid_until' })
  validUntil?: Date;

  @Prop({
    required: true,
    name: 'audience_type',
    enum: AnnouncementAudienceTypeEnum,
    default: AnnouncementAudienceTypeEnum.ALL,
  })
  audienceType: AnnouncementAudienceTypeEnum;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: UserModel.name }],
    default: [],
    name: 'audience_user_ids',
  })
  audienceUserIds: MongooseSchema.Types.ObjectId[];

  @Prop({
    type: [String],
    enum: AnnouncementPlacementEnum,
    default: [],
  })
  placements: AnnouncementPlacementEnum[];

  @Prop({
    required: false,
    enum: StoreAdActionTypeEnum,
    name: 'action_type',
  })
  actionType?: StoreAdActionTypeEnum;

  @Prop({ required: false, name: 'action_target' })
  actionTarget?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: false,
  })
  store?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: ProductModel.name,
    required: false,
  })
  product?: MongooseSchema.Types.ObjectId;

  @Prop({ default: true, name: 'dismissible' })
  dismissible: boolean;

  @Prop({
    required: false,
    name: 'config',
    type: AnnouncementConfigModel,
  })
  config?: AnnouncementConfigModel;
}

export const AnnouncementSchema =
  SchemaFactory.createForClass(AnnouncementModel);

export type AnnouncementModelDocument = AnnouncementModel & Document;
