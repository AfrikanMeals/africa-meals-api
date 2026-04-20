import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  SupportChatAuthorRole,
  SupportChatMessageKind,
  SupportChatMessageModel,
  SupportChatSatisfactionOutcome,
} from '@schemas/support-chat.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types, isValidObjectId } from 'mongoose';

function uid(user: UserModel): string {
  return (user._id as { toString(): string }).toString();
}

const SATISFACTION_QUESTION_FR =
  "Êtes-vous satisfait(e) de l'assistance reçue ?";
const CONTINUE_LINE_FR = "Je souhaite poursuivre l'échange avec le support.";

function mapLeanMessage(r: Record<string, unknown>) {
  const mk =
    (r.messageKind as string) ??
    (r.message_kind as string) ??
    SupportChatMessageKind.TEXT;
  const so = r.satisfactionOutcome ?? r.satisfaction_outcome;
  return {
    id: (r._id as { toString(): string }).toString(),
    authorRole: String(r.authorRole ?? r.author_role ?? ''),
    text: String(r.text ?? ''),
    createdAt: r.createdAt as Date,
    messageKind: mk as SupportChatMessageKind,
    satisfactionOutcome: so as SupportChatSatisfactionOutcome | undefined,
  };
}

function mapDocMessage(doc: SupportChatMessageModel) {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    authorRole: doc.authorRole,
    text: doc.text,
    createdAt: doc.createdAt,
    messageKind: doc.messageKind ?? SupportChatMessageKind.TEXT,
    satisfactionOutcome: doc.satisfactionOutcome,
  };
}

@Injectable()
export class SupportChatService {
  constructor(
    @InjectModel(SupportChatMessageModel.name)
    private readonly _chat: Model<SupportChatMessageModel>,
    @InjectModel(UserModel.name)
    private readonly _users: Model<UserModel>,
    @InjectModel(StoreModel.name)
    private readonly _stores: Model<StoreModel>,
  ) {}

  private assertNonAdmin(user: UserModel) {
    if (user.type === UserTypeEnum.ADMIN) {
      throw new ForbiddenException('support_chat_participant_only');
    }
  }

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  async listMyMessages(user: UserModel) {
    this.assertNonAdmin(user);
    const owner = new Types.ObjectId(uid(user));
    const rows = await this._chat
      .find({ threadOwnerId: owner })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return {
      items: rows.map((r) =>
        mapLeanMessage(r as unknown as Record<string, unknown>),
      ),
    };
  }

  async postMyMessage(user: UserModel, text: string) {
    this.assertNonAdmin(user);
    const owner = new Types.ObjectId(uid(user));
    const doc = await this._chat.create({
      threadOwnerId: owner,
      authorId: owner,
      authorRole: SupportChatAuthorRole.PARTICIPANT,
      text: text.trim(),
    });
    return {
      id: (doc._id as { toString(): string }).toString(),
      authorRole: doc.authorRole,
      text: doc.text,
      createdAt: doc.createdAt,
    };
  }

  async listConversationsForAdmin(admin: UserModel) {
    this.assertAdmin(admin);
    const pipeline = [
      { $sort: { createdAt: -1 as const } },
      {
        $group: {
          _id: '$threadOwnerId',
          lastMessage: { $first: '$$ROOT' },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 as const } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $lookup: {
          from: 'stores',
          let: { oid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$owner', '$$oid'] },
              },
            },
            { $limit: 1 },
            { $project: { name: 1 } },
          ],
          as: 'store',
        },
      },
    ];
    const rows = await this._chat.aggregate(pipeline).exec();
    return {
      items: rows.map((row: Record<string, unknown>) => {
        const u = row['user'] as Record<string, unknown>;
        const last = row['lastMessage'] as Record<string, unknown>;
        const storeArr = row['store'] as { name?: string }[];
        const storeName =
          Array.isArray(storeArr) && storeArr[0]?.name ? String(storeArr[0].name) : null;
        const pid = (row['_id'] as { toString(): string }).toString();
        return {
          participant: {
            id: pid,
            fullName: String(u['fullName'] ?? ''),
            email: String(u['email'] ?? ''),
            type: String(u['type'] ?? ''),
            profileImage: u['profileImage'] ? String(u['profileImage']) : undefined,
            storeName,
          },
          lastMessage: last
            ? {
                text: String(last['text'] ?? ''),
                authorRole: String(last['authorRole'] ?? last['author_role'] ?? ''),
                createdAt: last['createdAt'],
                messageKind: String(
                  last['messageKind'] ??
                    last['message_kind'] ??
                    SupportChatMessageKind.TEXT,
                ),
                satisfactionOutcome: (() => {
                  const raw =
                    last['satisfactionOutcome'] ?? last['satisfaction_outcome'];
                  return raw != null && raw !== ''
                    ? String(raw)
                    : undefined;
                })(),
              }
            : null,
          updatedAt: last['updatedAt'] ?? last['createdAt'],
        };
      }),
    };
  }

  private async assertParticipantThreadTarget(participantId: string) {
    if (!isValidObjectId(participantId)) {
      throw new BadRequestException('invalid_participant_id');
    }
    const p = await this._users.findById(participantId).select('type').lean().exec();
    if (!p) throw new NotFoundException('participant_not_found');
    if (p.type === UserTypeEnum.ADMIN) {
      throw new BadRequestException('invalid_participant');
    }
  }

  async listThreadForAdmin(admin: UserModel, participantId: string) {
    this.assertAdmin(admin);
    await this.assertParticipantThreadTarget(participantId);
    const owner = new Types.ObjectId(participantId);
    const rows = await this._chat
      .find({ threadOwnerId: owner })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return {
      items: rows.map((r) => ({
        id: (r._id as { toString(): string }).toString(),
        authorRole: r.authorRole,
        text: r.text,
        createdAt: r.createdAt,
      })),
    };
  }

  async postAdminReply(admin: UserModel, participantId: string, text: string) {
    this.assertAdmin(admin);
    await this.assertParticipantThreadTarget(participantId);
    const threadOwner = new Types.ObjectId(participantId);
    const author = new Types.ObjectId(uid(admin));
    const doc = await this._chat.create({
      threadOwnerId: threadOwner,
      authorId: author,
      authorRole: SupportChatAuthorRole.ADMIN,
      text: text.trim(),
      messageKind: SupportChatMessageKind.TEXT,
    });
    return mapDocMessage(doc);
  }

  async postClosureRequest(admin: UserModel, participantId: string) {
    this.assertAdmin(admin);
    await this.assertParticipantThreadTarget(participantId);
    const threadOwner = new Types.ObjectId(participantId);
    const pending = await this._chat
      .findOne({
        threadOwnerId: threadOwner,
        messageKind: SupportChatMessageKind.SATISFACTION_PROMPT,
        satisfactionOutcome: { $ne: SupportChatSatisfactionOutcome.NO_CONTINUE },
      })
      .exec();
    if (pending) {
      throw new BadRequestException('satisfaction_prompt_pending');
    }
    const author = new Types.ObjectId(uid(admin));
    const doc = await this._chat.create({
      threadOwnerId: threadOwner,
      authorId: author,
      authorRole: SupportChatAuthorRole.ADMIN,
      text: SATISFACTION_QUESTION_FR,
      messageKind: SupportChatMessageKind.SATISFACTION_PROMPT,
      satisfactionOutcome: SupportChatSatisfactionOutcome.PENDING,
    });
    return mapDocMessage(doc);
  }

  async respondSatisfaction(
    user: UserModel,
    promptMessageId: string,
    satisfied: boolean,
  ) {
    this.assertNonAdmin(user);
    if (!isValidObjectId(promptMessageId)) {
      throw new BadRequestException('invalid_prompt_id');
    }
    const owner = new Types.ObjectId(uid(user));
    const prompt = await this._chat
      .findOne({
        _id: new Types.ObjectId(promptMessageId),
        threadOwnerId: owner,
        messageKind: SupportChatMessageKind.SATISFACTION_PROMPT,
      })
      .exec();
    if (!prompt) {
      throw new NotFoundException('satisfaction_prompt_not_found');
    }
    const cur =
      prompt.satisfactionOutcome ?? SupportChatSatisfactionOutcome.PENDING;
    if (cur !== SupportChatSatisfactionOutcome.PENDING) {
      throw new BadRequestException('satisfaction_already_answered');
    }
    if (satisfied) {
      await this._chat.deleteMany({ threadOwnerId: owner }).exec();
      return { cleared: true as const };
    }
    prompt.satisfactionOutcome = SupportChatSatisfactionOutcome.NO_CONTINUE;
    await prompt.save();
    const doc = await this._chat.create({
      threadOwnerId: owner,
      authorId: owner,
      authorRole: SupportChatAuthorRole.PARTICIPANT,
      text: CONTINUE_LINE_FR,
      messageKind: SupportChatMessageKind.TEXT,
    });
    return {
      cleared: false as const,
      message: mapDocMessage(doc),
    };
  }
}
