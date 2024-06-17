import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IPaypalModuleOptions } from './interfaces/paypal.interfaces';
import { PaypalService } from './paypal.service';
import { PaypalController } from './paypal.controller';

@Module({
  providers: [
    PaypalService,
    {
      provide: 'PAYPAL_MODULE_OPTIONS',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          clientId: config.get('PAYPAL_CLIENT_ID'),
          clientSecret: config.get('PAYPAL_CLIENT_SECRET'),
          apiUrl:
            config.get('PAYPAL_ENVIRONMENT') !== 'live'
              ? 'https://api-m.sandbox.paypal.com'
              : 'https://api-m.paypal.com',
          axiosInstance: axios.create(),
        } as IPaypalModuleOptions;
      },
    },
  ],
  exports: [PaypalService],
  controllers: [PaypalController],
})
export class PaypalModule {}
