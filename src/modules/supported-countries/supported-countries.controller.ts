import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SupportedCountriesService } from './supported-countries.service';

@ApiTags('supported-countries')
@Controller('supported-countries')
export class SupportedCountriesController {
  constructor(
    private readonly _supportedCountries: SupportedCountriesService,
  ) {}

  @Get()
  async list() {
    const countries = await this._supportedCountries.listActive();
    return { countries };
  }
}
