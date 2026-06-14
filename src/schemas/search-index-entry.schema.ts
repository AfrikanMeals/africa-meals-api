import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SearchIndexEntityType = 'product' | 'store' | 'drink';

/** Entrée préparée pour recherche texte / vectorielle. */
@Schema({ timestamps: true, collection: 'search_index_entries' })
export class SearchIndexEntryModel {
  @Prop({
    type: String,
    required: true,
    enum: ['product', 'store', 'drink'],
    index: true,
  })
  entityType: SearchIndexEntityType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null, index: true })
  storeId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  title: string;

  @Prop({ type: String, default: '' })
  searchText: string;

  /** Vecteur embedding (Atlas Vector Search) — optionnel tant que l’API embedding n’est pas configurée. */
  @Prop({ type: [Number], default: undefined })
  embedding?: number[];

  @Prop({ type: Date, default: null })
  embeddedAt: Date | null;

  @Prop({ type: String, default: '' })
  sourceHash: string;
}

export type SearchIndexEntryDocument = HydratedDocument<SearchIndexEntryModel>;

export const SearchIndexEntrySchema =
  SchemaFactory.createForClass(SearchIndexEntryModel);

SearchIndexEntrySchema.index(
  { entityType: 1, entityId: 1 },
  { unique: true },
);
