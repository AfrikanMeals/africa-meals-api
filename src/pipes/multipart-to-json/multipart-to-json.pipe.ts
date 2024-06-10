import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class MultipartToJsonPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    if (value?.payload) {
      try {
        return JSON.parse(value.payload);
      } catch (e) {
        console.log(e);
        return value;
      }
    }
    return value;
  }
}
