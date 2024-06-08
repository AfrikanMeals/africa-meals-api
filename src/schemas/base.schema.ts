import { Prop } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class BaseSchema extends Document {
  id: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  // toJSON() {
  //   console.log(this);
  //   const obj = this.toObject();
  //   obj.id = obj._id;
  //   delete obj._id;
  //   delete obj.password;
  //   delete obj.__v;
  //   return obj;
  // }
}
