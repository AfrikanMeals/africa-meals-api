import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AddressModel } from '@schemas/address.schema';
import { UserModel } from '@schemas/user.schema';
import axios from 'axios';
import { Model } from 'mongoose';
import { CreateAddressDto, SearchAddressDto } from './dto/addresses.dto';

@Injectable()
export class AddressesService {
  @InjectModel(AddressModel.name)
  private readonly addressModel: Model<AddressModel>;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  async search(args: SearchAddressDto, user: UserModel) {
    const q = encodeURIComponent(
      `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
    );
    const url = `${this._configService.get<string>(
      'MAP_BOX_API_URL',
    )}?q=${q}&proximity=ip&types=address&access_token=${this._configService.get<string>(
      'MAPBOX_ACCESS_TOKEN',
    )}&limit=1&autocomplete=true&language=fr`;
    // console.log('🚀 ~ AddressesService ~ create ~ url:', url);
    const { data } = await axios.get(url);

    if (!data?.features?.length) {
      throw new NotFoundException('address_not_found');
    }
    // console.log(
    //   '🚀 ~ AddressesService ~ create ~ data:',
    //   JSON.stringify(data, null, 2),
    // );
    // const { lat, lng } = data.results[0].geometry.location;
    // const address = await this.addressModel.create({
    //   ...args,
    //   location: {
    //     type: 'Point',
    //     coordinates: [lat, lng],
    //   },
    // });
    const item = data?.features[0];
    return {
      address:
        item.properties.full_address ??
        item.name ??
        `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
      country: args.country,
      countryCode: item.properties.context?.country?.country_code,
      zipCode: args.zipCode,
      city: args.city,
      location: item.geometry.coordinates ?? [0, 0],
    };
  }

  async create(
    { latitude, longitude, ...args }: CreateAddressDto,
    user: UserModel,
  ) {
    const address = await this.addressModel.create({
      ...args,
      location: {
        type: 'Point',
        coordinates: [latitude, longitude],
      },
    });

    return this.addressModel.findOne({
      _id: address._id,
    });
  }
}
