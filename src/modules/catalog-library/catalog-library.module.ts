import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StoreComplementLibraryModel,
  StoreComplementLibrarySchema,
  StoreIngredientLibraryModel,
  StoreIngredientLibrarySchema,
  StoreSupplementLibraryModel,
  StoreSupplementLibrarySchema,
} from '@schemas/catalog-library.schema';
import { CatalogLibraryService } from './catalog-library.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      {
        name: StoreIngredientLibraryModel.name,
        schema: StoreIngredientLibrarySchema,
      },
      {
        name: StoreSupplementLibraryModel.name,
        schema: StoreSupplementLibrarySchema,
      },
      {
        name: StoreComplementLibraryModel.name,
        schema: StoreComplementLibrarySchema,
      },
    ]),
  ],
  providers: [CatalogLibraryService],
  exports: [CatalogLibraryService],
})
export class CatalogLibraryModule {}
