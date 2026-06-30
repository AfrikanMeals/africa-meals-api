import {
  ArgumentMetadata,
  ValidationPipe,
} from '@nestjs/common';
import { MultipartToJsonPipe } from 'src/pipes/multipart-to-json/multipart-to-json.pipe';

/** Parse `payload` multipart puis valide — évite le ValidationPipe global sur le corps brut. */
export async function parseMultipartJsonBody<T extends object>(
  body: unknown,
  metatype: new () => T,
): Promise<T> {
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype,
    data: '',
  };
  const parsed = new MultipartToJsonPipe().transform(body, metadata);
  return (await new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }).transform(parsed, metadata)) as T;
}
