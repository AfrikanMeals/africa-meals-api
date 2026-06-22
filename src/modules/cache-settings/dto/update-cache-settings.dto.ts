import {
  APP_CACHE_MODULE_KEYS,
  type AppCacheModuleKey,
  type CacheEngine,
  DEFAULT_MODULE_ENGINES,
  type ModuleEngineMap,
} from '@common/cache/cache-engine.types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const CACHE_ENGINES = ['redis', 'memcached', 'memory'] as const;

export class ModuleEnginesDto implements ModuleEngineMap {
  @ApiProperty({ enum: CACHE_ENGINES })
  @IsIn(CACHE_ENGINES)
  publicCatalog: CacheEngine;

  @ApiProperty({ enum: CACHE_ENGINES })
  @IsIn(CACHE_ENGINES)
  favorites: CacheEngine;

  @ApiProperty({ enum: CACHE_ENGINES })
  @IsIn(CACHE_ENGINES)
  productCategories: CacheEngine;

  @ApiProperty({ enum: CACHE_ENGINES })
  @IsIn(CACHE_ENGINES)
  checkoutPreview: CacheEngine;
}

export class UpdateCacheSettingsDto {
  @ApiProperty({ example: 90_000, description: 'TTL catalogue public (ms).' })
  @IsInt()
  @Min(5_000)
  @Max(3_600_000)
  publicCatalogTtlMs: number;

  @ApiProperty({ example: 25_000, description: 'TTL listes favoris (ms).' })
  @IsInt()
  @Min(5_000)
  @Max(600_000)
  favoritesTtlMs: number;

  @ApiProperty({ example: 120_000, description: 'TTL catégories produits (ms).' })
  @IsInt()
  @Min(5_000)
  @Max(3_600_000)
  productCategoriesTtlMs: number;

  @ApiPropertyOptional({ type: ModuleEnginesDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ModuleEnginesDto)
  moduleEngines?: ModuleEnginesDto;
}

export function normalizeModuleEngines(
  raw: Partial<ModuleEngineMap> | null | undefined,
): ModuleEngineMap {
  const out = { ...DEFAULT_MODULE_ENGINES };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of APP_CACHE_MODULE_KEYS) {
    const v = raw[key];
    if (v === 'redis' || v === 'memcached' || v === 'memory') {
      out[key] = v;
    }
  }
  return out;
}

export function moduleEnginesFromDoc(
  doc: { moduleEngines?: Partial<ModuleEngineMap> | null },
): ModuleEngineMap {
  return normalizeModuleEngines(doc.moduleEngines);
}

export type { AppCacheModuleKey, CacheEngine, ModuleEngineMap };
