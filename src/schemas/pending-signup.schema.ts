import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { UserTypeEnum } from './user.schema';

/**
 * Données d’inscription avant création du document `users` : le compte n’existe
 * qu’après validation du code e-mail (`register/complete`).
 */
@Schema({
  timestamps: true,
  collection: 'pending_signups',
})
export class PendingSignupModel {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /** Hash bcrypt (une passe) — finalisation : copié sur l’utilisateur sans re-hasher (hook user). */
  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ required: true, enum: UserTypeEnum })
  userType: UserTypeEnum;

  @Prop({ required: true, trim: true })
  verificationCode: string;

  /** Suppression automatique MongoDB après cette date (TTL index). */
  @Prop({ required: true })
  expiresAt: Date;
}

export const PendingSignupSchema =
  SchemaFactory.createForClass(PendingSignupModel);

PendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
