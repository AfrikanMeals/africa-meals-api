import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum SupportChatAuthorRole {
  PARTICIPANT = 'PARTICIPANT',
  ADMIN = 'ADMIN',
}

export enum SupportChatMessageKind {
  TEXT = 'TEXT',
  SATISFACTION_PROMPT = 'SATISFACTION_PROMPT',
}

export enum SupportChatSatisfactionOutcome {
  PENDING = 'PENDING',
  NO_CONTINUE = 'NO_CONTINUE',
}

@Schema({
  timestamps: true,
  collection: 'support_chat_messages',
  toJSON: { getters: true, virtuals: true },
})
export class SupportChatMessageModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    index: true,
    name: 'thread_owner_id',
  })
  threadOwnerId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    name: 'author_id',
  })
  authorId: MongooseSchema.Types.ObjectId;

  @Prop({
    enum: SupportChatAuthorRole,
    required: true,
    name: 'author_role',
  })
  authorRole: SupportChatAuthorRole;

  @Prop({ required: true, maxlength: 8000 })
  text: string;

  @Prop({
    enum: SupportChatMessageKind,
    default: SupportChatMessageKind.TEXT,
    name: 'message_kind',
  })
  messageKind: SupportChatMessageKind;

  @Prop({
    enum: SupportChatSatisfactionOutcome,
    required: false,
    name: 'satisfaction_outcome',
  })
  satisfactionOutcome?: SupportChatSatisfactionOutcome;
}

export const SupportChatMessageSchema = SchemaFactory.createForClass(
  SupportChatMessageModel,
);

SupportChatMessageSchema.index({ threadOwnerId: 1, createdAt: 1 });
