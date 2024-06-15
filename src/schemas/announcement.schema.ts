import { SearchContent } from '@modules/search/dto/search.dto';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';

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

  @Prop({ required: true, name: 'action_text' })
  actionText: string;

  @Prop({ required: false, name: 'picture_url' })
  pictureUrl?: string;

  @Prop({
    required: true,
    name: 'config',
    type: AnnouncementConfigModel,
  })
  config: AnnouncementConfigModel;
}

export const AnnouncementSchema =
  SchemaFactory.createForClass(AnnouncementModel);

export type AnnouncementModelDocument = AnnouncementModel & Document;
