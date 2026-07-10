import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

/** Admin — traiter transfers / versement livreur hors calendrier badge. */
export class AdminProcessDeliveryAgentPaymentsDto {
  /** Commandes à (re)transferer vers le Connect livreur. Vide = aucun transfer ciblé. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  orderIds?: string[];

  /**
   * Déclenche un payout du solde disponible en ignorant le badge
   * (tente `instant`, repli `standard`). Défaut : true.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  forceInstantPayout?: boolean;

  /** Si true : ne fait que le payout (ignore orderIds pour les transfers). */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  payoutOnly?: boolean;
}
