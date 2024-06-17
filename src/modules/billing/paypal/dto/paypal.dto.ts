// import { PaypalPayerDto, PurchaseUnitRequestDto, PaypalApplicationContextDto } from '@app/dtos';

import { PaymentMetodProviderEnum } from '@schemas/payment-method.schema';
import { Type } from 'class-transformer';
import {
  IsCreditCard,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  Matches,
  ValidateNested,
} from 'class-validator';

class BasePaymentMethodDto {
  @IsNotEmpty()
  @IsEnum(PaymentMetodProviderEnum)
  type: PaymentMetodProviderEnum;
}

export class CreatePaypalPaymentMethod extends BasePaymentMethodDto {}

export class CreatePaypalCardPaymentMethod extends BasePaymentMethodDto {
  @IsNotEmpty()
  @IsCreditCard()
  cardNumber: string;

  @IsNotEmpty()
  cvc: string;

  @IsNotEmpty()
  @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
  expiry: string;

  @IsNotEmpty()
  name: string;
}

export class CreatePaymentMethodDto {
  @IsNotEmpty()
  @ValidateNested()
  @IsDefined()
  @Type(() => BasePaymentMethodDto, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'type',
      subTypes: [
        {
          value: CreatePaypalPaymentMethod,
          name: PaymentMetodProviderEnum.PAYPAL,
        },
        {
          value: CreatePaypalCardPaymentMethod,
          name: PaymentMetodProviderEnum.PAYPAL_CARD,
        },
      ],
    },
  })
  payload: CreatePaypalPaymentMethod | CreatePaypalCardPaymentMethod;
}

export class CreatePaypalOrderDto {}
