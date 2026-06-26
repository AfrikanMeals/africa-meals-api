import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

/** Documente les query params de projection de champs sur un endpoint. */
export function ApiFieldSelection() {
  return applyDecorators(
    ApiQuery({
      name: 'fields',
      required: false,
      description:
        'Champs inclus (whitelist, séparés par virgule). Ex. `id,name,user.address[].city`',
      example: 'id,name,email',
    }),
    ApiQuery({
      name: 'include',
      required: false,
      description: 'Alias de `fields` pour inclusion explicite.',
    }),
    ApiQuery({
      name: 'exclude',
      required: false,
      description: 'Champs exclus. Ex. `passwordHash,metadata.internal`',
    }),
    ApiQuery({
      name: 'fieldsRoot',
      required: false,
      description:
        'Scope de projection pour enveloppes paginées (ex. `items`).',
      example: 'items',
    }),
    ApiQuery({
      name: 'includeFields',
      required: false,
      description: 'Alias legacy (mobile) — équivalent à `fields`.',
    }),
    ApiQuery({
      name: 'excludeFields',
      required: false,
      description: 'Alias legacy — équivalent à `exclude`.',
    }),
  );
}
