import { IsIn } from 'class-validator';

export class UpdateDashboardLivreurStatutDto {
  @IsIn(['disponible', 'hors_ligne'])
  statut: 'disponible' | 'hors_ligne';
}
