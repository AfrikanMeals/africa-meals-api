import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Type } from 'class-transformer';
import { Schema as MongooseSchema } from 'mongoose';
import { AddressModel } from './address.schema';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'users',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class UserModel extends BaseSchema {
  @Prop({ required: true, name: 'full_name' })
  fullName: string;

  @Prop({ required: true, name: 'email', unique: true })
  email: string;

  @Prop({ required: false, name: 'phone_number' })
  phoneNumber?: string;

  @Prop({
    required: false,
    default: null,
    type: 'date',
    name: 'email_verified_at',
  })
  emailVerifiedAt?: Date;

  @Prop({ required: false, name: 'facebook_id' })
  facebookId?: string;

  @Prop({ required: false, name: 'google_id' })
  googleId?: string;

  @Prop({
    required: false,
    name: 'address',
    type: [MongooseSchema.Types.ObjectId],
    ref: AddressModel.name,
    default: [],
  })
  @Type(() => Array<AddressModel>)
  addresses?: AddressModel[];

  @Prop({ required: true, name: 'password', select: false })
  password: string;

  @Prop({ required: false, name: 'activation_code', select: false })
  activationCode?: string;

  @Prop({ required: false, name: 'password_reset_code', select: false })
  passwordResetCode?: string;

  // @Prop({
  //   get: (creditCardNumber: string) => {
  //     if (!creditCardNumber) {
  //       return;
  //     }
  //     const lastFourDigits = creditCardNumber.slice(
  //       creditCardNumber.length - 4,
  //     );
  //     return `****-****-****-${lastFourDigits}`;
  //   },
  // })
  // creditCardNumber?: string;
}

export const UserSchema = SchemaFactory.createForClass(UserModel);

// UserSchema.virtual('id').get(function () {
//   return (this._id as any).toHexString();
// });

UserSchema.pre('save', async function (next) {
  try {
    if (!this.isModified('password')) {
      return next();
    }
    const hashed = await bcrypt.hash(this['password'], 10);
    this['password'] = hashed;
    return next();
  } catch (error) {
    return next(error);
  }
});

export type UserModelDocument = UserModel & Document;
