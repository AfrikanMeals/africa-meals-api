import { UsersService } from '@modules/users/users.service';
import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PaymentMethodModel,
  PaymentMetodProviderEnum,
} from '@schemas/payment-method.schema';
import { UserModel } from '@schemas/user.schema';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { PaypalService } from './paypal/paypal.service';

// TODO: For payouts, create a table to store payout transactions for every order
@Injectable()
export class BillingService {
  @InjectModel(PaymentMethodModel.name)
  private readonly _paymentMethodModel: Model<PaymentMethodModel>;

  @Inject(PaypalService) private readonly _paypalService: PaypalService;
  @Inject(UsersService) private readonly _usersService: UsersService;

  async savePaypalPaymentMethod(setupTokenId: string, user: UserModel) {
    try {
      const token = await this._paypalService.createPaymentToken(
        setupTokenId,
        user,
      );

      const hasMaymentMethod = await this._paymentMethodModel
        .findOne({
          user: new ObjectId(user.id),
        })
        .exec();

      const method = await this._paymentMethodModel.create({
        user,
        isDefault: !hasMaymentMethod,
        provider: token.isCard
          ? PaymentMetodProviderEnum.PAYPAL_CARD
          : PaymentMetodProviderEnum.PAYPAL,
        providerId: token.id,
        prodiderCustomerId: token.customerId,
        ...(token.isCard && {
          card: {
            brand: token.brand,
            last4: token.last4,
            expiry: token.expiry,
            name: token.name,
          },
        }),
        ...(!token.isCard && {
          prodiderUserName: token.emailId,
        }),
        userId: new ObjectId(user.id),
      });

      await this._usersService.attachPaymentMethod(method, user);

      return await this._paymentMethodModel
        .find({
          user: user.id,
        })
        .exec();
    } catch (e) {
      console.log('🚀 ~ BillingService ~ savePaypalPaymentMethod ~ e:', e);
      throw new HttpException(
        e?.reponse?.data ?? e,
        e.reponse?.status ?? e.status ?? 500,
        {
          cause: new Error(e?.reponse?.data ?? e),
        },
      );
    }
  }

  async deletePaypalPaymentMethod(
    id: string,
    user: UserModel,
  ): Promise<void> {
    try {
      // TODO should check payment provider
      //! TODO should check if payment method is default ??
      const method = await this._paymentMethodModel.findOne({
        _id: new ObjectId(id),
      });
      if (!method) {
        throw new NotFoundException('payment_method_not_found');
      }

      await this._usersService.detachPaymentMethod(method, user);

      const response = await this._paypalService.deletePaymentMethod(
        method.providerId,
        user,
      );
      console.log(
        '🚀 ~ BillingService ~ deletePaypalPaymentMethod ~ response:',
        response,
      );
      await this._paymentMethodModel
        .deleteOne({
          _id: new ObjectId(id),
          user: user.id,
        })
        .exec();
    } catch (e) {
      console.log('🚀 ~ BillingService ~ deletePaypalPaymentMethod ~ e:', e);
      throw new HttpException(
        e?.reponse?.data ?? e,
        e.reponse?.status ?? e.status ?? 500,
        {
          cause: new Error(e?.reponse?.data ?? e),
        },
      );
    }
  }
}
