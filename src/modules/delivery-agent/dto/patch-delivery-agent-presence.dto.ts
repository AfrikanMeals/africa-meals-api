import { IsIn } from 'class-validator';

export class PatchDeliveryAgentPresenceDto {
  @IsIn(['disponible', 'hors_ligne'])
  availability: 'disponible' | 'hors_ligne';
}
