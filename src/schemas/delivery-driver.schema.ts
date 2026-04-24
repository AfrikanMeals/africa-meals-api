import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';

export enum DeliveryDriverStatutEnum {
  DISPONIBLE = 'disponible',
  EN_LIVRAISON = 'en_livraison',
  HORS_LIGNE = 'hors_ligne',
}

export enum DeliveryDriverVehiculeEnum {
  MOTO = 'Moto',
  VELO = 'Vélo',
  VOITURE = 'Voiture',
}

@Schema({ _id: false })
export class DeliveryDriverCommandeEnCours {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  client: string;

  @Prop({ required: true })
  adresse: string;

  @Prop({ required: true })
  eta: string;
}

export const DeliveryDriverCommandeEnCoursSchema = SchemaFactory.createForClass(
  DeliveryDriverCommandeEnCours,
);

@Schema({ _id: false })
export class DeliveryDriverCoords {
  @Prop({ required: true, min: 0, max: 100 })
  x: number;

  @Prop({ required: true, min: 0, max: 100 })
  y: number;
}

export const DeliveryDriverCoordsSchema =
  SchemaFactory.createForClass(DeliveryDriverCoords);

/**
 * Livreurs par boutique — collection MongoDB `delivery_drivers`.
 */
@Schema({
  timestamps: true,
  collection: 'delivery_drivers',
  toJSON: { virtuals: true, getters: true },
})
export class DeliveryDriverModel extends BaseSchema {
  /** Boutique propriétaire de ce livreur (obligatoire pour les nouveaux enregistrements). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: false,
    index: true,
  })
  store?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  nom: string;

  @Prop({ required: true })
  avatar: string;

  @Prop({ required: true, trim: true })
  tel: string;

  @Prop({
    required: true,
    enum: DeliveryDriverStatutEnum,
    default: DeliveryDriverStatutEnum.DISPONIBLE,
  })
  statut: DeliveryDriverStatutEnum;

  @Prop({ required: true, trim: true })
  zone: string;

  @Prop({
    required: true,
    enum: DeliveryDriverVehiculeEnum,
    default: DeliveryDriverVehiculeEnum.MOTO,
  })
  vehicule: DeliveryDriverVehiculeEnum;

  @Prop({ required: true, default: '—' })
  immat: string;

  @Prop({ required: true, default: 4.5, min: 0, max: 5 })
  note: number;

  @Prop({ required: true, default: 0, min: 0 })
  livraisons_jour: number;

  @Prop({ required: true, default: 0, min: 0 })
  livraisons_total: number;

  @Prop({ required: true, default: 25, min: 0 })
  temps_moyen: number;

  @Prop({ required: true, default: 0, min: 0 })
  distance_jour: number;

  @Prop({ required: true, default: 0, min: 0 })
  revenu_jour: number;

  @Prop({ required: true, default: 2, min: 1 })
  capacite: number;

  @Prop({
    type: DeliveryDriverCommandeEnCoursSchema,
    required: false,
    default: null,
  })
  commande_en_cours: DeliveryDriverCommandeEnCours | null;

  @Prop({
    type: DeliveryDriverCoordsSchema,
    required: true,
  })
  coords: DeliveryDriverCoords;

  /** Position réelle (WGS84) pour carte Mapbox ; sinon dérivée de `coords`. */
  @Prop({ required: false, min: -180, max: 180 })
  longitude?: number;

  @Prop({ required: false, min: -90, max: 90 })
  latitude?: number;
}

export const DeliveryDriverSchema =
  SchemaFactory.createForClass(DeliveryDriverModel);
