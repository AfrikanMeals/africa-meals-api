import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class LineComplementOptionSnapshot {
  @Prop({ required: true, name: 'label' })
  label: string;

  @Prop({ required: false, name: 'price_delta', default: 0 })
  priceDelta: number;
}

export const LineComplementOptionSnapshotSchema =
  SchemaFactory.createForClass(LineComplementOptionSnapshot);

@Schema({ _id: false })
export class LineComplementGroupSnapshot {
  @Prop({ required: true, name: 'group_title' })
  groupTitle: string;

  @Prop({
    type: [LineComplementOptionSnapshotSchema],
    default: [],
    name: 'options',
  })
  options: LineComplementOptionSnapshot[];
}

export const LineComplementGroupSnapshotSchema = SchemaFactory.createForClass(
  LineComplementGroupSnapshot,
);

@Schema({ _id: false })
export class LineSupplementSnapshot {
  @Prop({ required: true, name: 'name' })
  name: string;

  @Prop({ required: false, name: 'price', default: 0 })
  price: number;
}

export const LineSupplementSnapshotSchema =
  SchemaFactory.createForClass(LineSupplementSnapshot);

export type NormalizedLineComplementGroup = {
  groupTitle: string;
  options: Array<{ label: string; priceDelta: number }>;
};

export type NormalizedLineSupplement = {
  name: string;
  price: number;
};
