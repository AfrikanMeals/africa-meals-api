import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdModel } from '@schemas/ad.schema';

@Injectable()
export class AdsService implements OnModuleInit {
  @InjectModel(AdModel.name)
  private readonly adModel: Model<AdModel>;

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  async list() {
    return this.adModel
      .find({ isActive: true })
      .sort({ sortOrder: 1 })
      .exec();
  }

  async seedIfEmpty() {
    const count = await this.adModel.countDocuments().exec();
    if (count > 0) return;
    await this.adModel.insertMany([
      {
        isActive: true,
        title: 'Special Offer',
        subtitle: 'Discount 20% off applied at checkout',
        actionText: 'Order Now',
        imageUrl: null,
        sortOrder: 0,
      },
      {
        isActive: true,
        title: 'Free Delivery',
        subtitle: 'On orders over $25 this week',
        actionText: 'Shop Now',
        imageUrl: null,
        sortOrder: 1,
      },
      {
        isActive: true,
        title: 'New Arrivals',
        subtitle: 'Discover our latest dishes',
        actionText: 'Explore',
        imageUrl: null,
        sortOrder: 2,
      },
    ]);
  }
}
