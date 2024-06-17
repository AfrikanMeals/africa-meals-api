import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMetodProviderEnum } from '@schemas/payment-method.schema';
import { UserModel } from '@schemas/user.schema';
import {
  PAYPAL_AUTHORIZATION_HEADERS,
  PaypalErrorsConstants,
} from '../constants';
import {
  CreatePaymentMethodDto,
  CreatePaypalCardPaymentMethod,
  CreatePaypalOrderDto,
} from './dto/paypal.dto';
import {
  IPaypalModuleOptions,
  IPaypalTokenResponse,
} from './interfaces/paypal.interfaces';

// Useful resources
// - Handle saved payment methods: https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/

@Injectable()
export class PaypalService implements OnModuleInit {
  @Inject('PAYPAL_MODULE_OPTIONS')
  private readonly _options: IPaypalModuleOptions;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  async createSetupToken(
    { payload: args }: CreatePaymentMethodDto,
    user: UserModel,
  ) {
    if (!user.addresses?.length) {
      throw new BadRequestException('no_address');
    }

    const address =
      user.addresses.find((a) => a.isDefault) ?? user.addresses[0];
    console.log('🚀 ~ PaypalService ~ address:', address);

    let payload;

    if (args.type === PaymentMetodProviderEnum.PAYPAL_CARD) {
      const _args = args as CreatePaypalCardPaymentMethod;
      payload = {
        payment_source: {
          card: {
            number: _args.cardNumber, //'371449635398431',
            expiry: _args.expiry, //'2029-06',
            name: _args.name,
            cvc: _args.cvc,
            billing_address: {
              address_line_1: address.address, //'1036 Rue de la Loire',
              // address_line_2: '17.3.160',
              admin_area_1: address.city,
              // admin_area_2: 'Quebec',
              postal_code: address.zipCode,
              country_code: address.countryCode,
            },
            experience_context: {
              shipping_preference: 'NO_SHIPPING',
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              // brand_name: 'EXAMPLE INC',
              // locale: 'en-US',
              landing_page: 'LOGIN',
              // shipping_preference: 'SET_PROVIDED_ADDRESS',
              user_action: 'PAY_NOW',
              return_url: `${this._configService.get<string>(
                'SERVER_URL',
              )}/paypal/success`,
              cancel_url: `${this._configService.get<string>(
                'SERVER_URL',
              )}/paypal/cancel`,
            },
          },
        },
      };
    } else if (args.type === PaymentMetodProviderEnum.PAYPAL) {
      payload = {
        payment_source: {
          paypal: {
            description: `Saved payment method for ${this._configService.get(
              'APP_NAME',
            )}`,
            shipping: {
              name: {
                full_name: user.fullName,
              },
              address: {
                address_line_1: address.address,
                // address_line_2: '17.3.160',
                admin_area_1: address.city,
                admin_area_2: address.city,
                postal_code: address.zipCode,
                country_code: address.countryCode,
              },
            },
            permit_multiple_payment_tokens: false,
            usage_pattern: 'IMMEDIATE',
            usage_type: user.stores?.length > 0 ? 'MERCHANT' : 'PLATFORM', // 'MERCHANT',
            customer_type: 'CONSUMER',
            experience_context: {
              brand_name: this._configService.get<string>('APP_NAME'),
              shipping_preference: 'NO_SHIPPING',
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              // brand_name: 'EXAMPLE INC',
              // locale: 'en-US',
              // landing_page: 'LOGIN',
              // shipping_preference: 'SET_PROVIDED_ADDRESS',
              // user_action: 'PAY_NOW',
              return_url: `${this._configService.get<string>(
                'SERVER_URL',
              )}/paypal/success`,
              cancel_url: `${this._configService.get<string>(
                'SERVER_URL',
              )}/paypal/cancel`,
            },
            // permit_multiple_payment_tokens: true,
            // usage_type: 'RECURRING',
          },
        },
      };
    } else {
      throw new BadRequestException('unknown_type');
    }

    // const _payload = {
    //   payment_source: {
    //     paypal: {
    //       description: 'Put some description here',
    //       shipping: {
    //         name: {
    //           full_name: user.fullName,
    //         },
    //         address: {
    //           address_line_1: '1036 Rue de la Loire',
    //           // address_line_2: '17.3.160',
    //           admin_area_1: 'Quebec',
    //           admin_area_2: 'Quebec',
    //           postal_code: 'G1V 2Z5',
    //           country_code: 'CA',
    //         },
    //       },
    //       permit_multiple_payment_tokens: false,
    //       usage_pattern: 'IMMEDIATE',
    //       usage_type: 'MERCHANT', // 'PLATFORM',
    //       customer_type: 'CONSUMER',
    //       experience_context: {
    //         brand_name: 'African Meals',
    //         shipping_preference: 'NO_SHIPPING',
    //         payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
    //         // brand_name: 'EXAMPLE INC',
    //         // locale: 'en-US',
    //         // landing_page: 'LOGIN',
    //         // shipping_preference: 'SET_PROVIDED_ADDRESS',
    //         // user_action: 'PAY_NOW',
    //         return_url: 'https://d2303a044412.ngrok.app',
    //         cancel_url: 'https://d2303a044412.ngrok.app',
    //       },
    //       // permit_multiple_payment_tokens: true,
    //       // usage_type: 'RECURRING',
    //     },
    //     // card: {
    //     //   number: '371449635398431',
    //     //   expiry: '2029-06',
    //     //   name: 'African Meals',
    //     //   cvc: '123',
    //     //   billing_address: {
    //     //     address_line_1: '1036 Rue de la Loire',
    //     //     // address_line_2: '17.3.160',
    //     //     admin_area_1: 'Quebec',
    //     //     // admin_area_2: 'Quebec',
    //     //     postal_code: 'G1V 2Z5',
    //     //     country_code: 'CA',
    //     //   },
    //     //   experience_context: {
    //     //     shipping_preference: 'NO_SHIPPING',
    //     //     payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
    //     //     // brand_name: 'EXAMPLE INC',
    //     //     // locale: 'en-US',
    //     //     landing_page: 'LOGIN',
    //     //     // shipping_preference: 'SET_PROVIDED_ADDRESS',
    //     //     user_action: 'PAY_NOW',
    //     //     // return_url: 'http://localhost:9000',
    //     //     // cancel_url: 'http://localhost:9000',
    //     //   },
    //     // },
    //   },
    // };
    try {
      const _headers = await this._prepareRequestHeaders();
      const response = await this._options.axiosInstance.post(
        `${this._options.apiUrl}/v3/vault/setup-tokens`,
        payload,
        {
          headers: _headers,
        },
      );

      if (args.type === PaymentMetodProviderEnum.PAYPAL) {
        const aproveUrl = response.data.links.find((l) => l.rel === 'approve');
        return { aproveUrl: aproveUrl.href, id: response.data.id };
      } else {
        return { id: response.data.id };
      }
    } catch (e) {
      console.log('🚀 ~ PaypalService ~ e:', e);
      throw new HttpException(
        e.response.data,
        e.response.status ?? HttpStatus.BAD_REQUEST,
        {
          cause: e.response.data,
        },
      );
    }
  }

  async createPaymentToken(setUpId: string, user: UserModel) {
    const payload = {
      payment_source: {
        token: {
          id: setUpId,
          type: 'SETUP_TOKEN',
        },
      },
    };

    try {
      const _headers = await this._prepareRequestHeaders();
      const response = await this._options.axiosInstance.post(
        `${this._options.apiUrl}/v3/vault/payment-tokens`,
        payload,
        {
          headers: _headers,
        },
      );

      if (!response.data) {
        console.log(
          '🚀 ~ PaypalService ~ createPaymentToken ~ response:',
          response,
        );
        throw new BadRequestException();
      }

      return {
        id: response.data.id,
        isCard: 'card' in response.data.payment_source,
        customerId: response.data.customer?.id,
        ...(response.data.payment_source?.paypal && {
          emailId: response.data.payment_source?.paypal?.email_address,
        }),
        ...(response.data.payment_source?.card && {
          last4: response.data.payment_source?.card?.last_digits,
          name: response.data.payment_source?.card?.name,
          expiry: response.data.payment_source?.card?.exiry,
          brand: response.data.payment_source?.card?.brand,
        }),
      };
    } catch (e) {
      console.log('🚀 ~ PaypalService ~ createPaymentToken ~ e:', e);
      throw new HttpException(
        e.response.data,
        e.response.status ?? HttpStatus.BAD_REQUEST,
        {
          cause: e.response.data,
        },
      );
    }
  }

  async deletePaymentMethod(paymentMethodId: string, user: UserModel) {
    try {
      const _headers = await this._prepareRequestHeaders();
      const response = await this._options.axiosInstance.delete(
        `${this._options.apiUrl}/v3/vault/payment-tokens/${paymentMethodId}`,
        {
          headers: _headers,
        },
      );

      return response.data ?? {};
    } catch (e) {
      console.log('🚀 ~ BillingService ~ deletePaymentMethod ~ e:', e);
      throw new HttpException(e?.reponse?.data ?? e, e.reponse?.status ?? 500, {
        cause: new Error(e?.reponse?.data ?? e),
      });
    }
  }

  async createVaultToken(user: UserModel) {
    const payload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'CAD', // TODO extract from store / user
            value: '0.01', // Minimal charge to create vault token
          },
          shipping: {
            address: {
              address_line_1: '1036 Rue de la loire',
              // address_line_2: 'Building 17',
              admin_area_2: 'Quebec',
              // admin_area_1: 'CA',
              postal_code: 'G1V 2Z5',
              country_code: 'CA',
            },
          },
        },
      ],
      payment_source: {
        paypal: {
          experiece_context: {
            shipping_preference: 'NO_SHIPPING',
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            brand_name: 'EXAMPLE INC',
            locale: 'en-US',
            landing_page: 'LOGIN',
            // shipping_preference: 'SET_PROVIDED_ADDRESS',
            user_action: 'PAY_NOW',

            //   brand_name: 'Safeway',
            //   landing_page: 'NO_PREFERENCE',
            //   user_action: 'PAY_NOW',
            //   return_url: 'https://www.safeway.com',
            //   cancel_url: 'https://www.safeway.com',
          },
        },
      },
      // application_context: {
      //   shipping_preference: 'NO_SHIPPING',
      // },
      // application_context: {
      //   brand_name: 'Safeway',
      //   landing_page: 'NO_PREFERENCE',
      //   user_action: 'PAY_NOW',
      //   return_url: 'https://www.safeway.com',
      //   cancel_url: 'https://www.safeway.com',
      // },
    };

    try {
      const order = await this.initiateOrder(payload);
      console.log('🚀 ~ PaypalService ~ createVaultToken ~ order:', order);
      const approvalUrl = (order.links ?? []).find(
        (link) => link.rel === 'approve',
      ).href;

      return {
        approvalUrl,
        id: order.id,
      };
    } catch (e) {
      console.log('🚀 ~ PaypalService ~ createVaultToken ~ e:', e);
      throw new BadRequestException(e);
    }
  }

  async initiateOrder(
    args: CreatePaypalOrderDto,
    headers?: {
      [key: string]: string;
    },
  ) {
    const _headers = await this._prepareRequestHeaders(headers);
    return this._options.axiosInstance
      .post(`${this._options.apiUrl}/v2/checkout/orders`, args, {
        headers: _headers,
      })
      .then((r) => r.data)
      .catch((e) => {
        throw {
          ...PaypalErrorsConstants.INITIATE_ORDER_FAILED,
          nativeError: e?.response?.data || e,
        };
      });
  }

  async onModuleInit() {
    // const order = await this.createVaultToken();
    // const token = await this._getAccessToken();
    // console.log('🚀 ~ PaypalService ~ onModuleInit ~ token:', token);
  }

  private _getBasicKey() {
    // console.log(this._options);
    return Buffer.from(
      this._options.clientId + ':' + this._options.clientSecret,
    ).toString('base64');
  }

  private async _getAccessToken(): Promise<IPaypalTokenResponse> {
    const basicKey = this._getBasicKey();
    const data = new URLSearchParams();
    data.append('grant_type', 'client_credentials');
    try {
      const response = await this._options.axiosInstance.post(
        this._options.apiUrl + '/v1/oauth2/token',
        data,
        {
          headers: {
            ...PAYPAL_AUTHORIZATION_HEADERS,
            Authorization: `Basic ${basicKey}`,
          },
        },
      );

      return response.data as IPaypalTokenResponse;
    } catch (e) {
      console.log('🚀 ~ PaypalService ~ asyncgetAccessToken ~ e:', e);
      throw {
        ...PaypalErrorsConstants.INVALID_CREDENTIALS,
        nativeError: e?.response?.data || e,
      };
    }
  }

  private async _prepareRequestHeaders(customHeaders?: any) {
    try {
      const initiateTokenResponse = await this._getAccessToken();
      const { access_token } = initiateTokenResponse;
      return {
        'Content-Type': 'application/json',
        Authorization: access_token
          ? `Bearer ${access_token}`
          : `Basic ${this._getBasicKey()}`,
        ...customHeaders,
      };
    } catch (e) {}
  }
}
