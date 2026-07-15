import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
} from 'class-validator';

/**
 * Regroupe les boutiques du checkout dans une seule lecture de disponibilité.
 * La limite protège Mongo/Redis contre les payloads publics non bornés.
 */
export class CheckoutCourierAvailabilityDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  storeIds: string[];
}
