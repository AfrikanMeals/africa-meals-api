import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GraphdbSettingsModel,
  GraphdbSettingsSchema,
} from '@schemas/graphdb-settings.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { Neo4jModule } from '@modules/neo4j/neo4j.module';
import { GraphdbSettingsController } from './graphdb-settings.controller';
import { GraphdbSettingsService } from './graphdb-settings.service';

@Module({
  imports: [
    TeamsModule,
    Neo4jModule,
    MongooseModule.forFeature([
      { name: GraphdbSettingsModel.name, schema: GraphdbSettingsSchema },
    ]),
  ],
  controllers: [GraphdbSettingsController],
  providers: [GraphdbSettingsService],
  exports: [GraphdbSettingsService],
})
export class GraphdbSettingsModule {}
