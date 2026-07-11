import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Flags Neo4j / GraphDB (singleton `key=default`), pilotés depuis Admin → GraphDB.
 * Secrets URI / password restent en env (jamais ici).
 */
@Schema({ timestamps: true, collection: 'graphdb_settings' })
export class GraphdbSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Kill-switch global : driver, health, workers, jobs batch. */
  @Prop({ type: Boolean, default: false, name: 'neo4j_enabled' })
  neo4jEnabled: boolean;

  /** Lectures reco via Neo4j (no-op si neo4jEnabled=false). */
  @Prop({ type: Boolean, default: false, name: 'reco_graph_enabled' })
  recoGraphEnabled: boolean;

  /** Écritures sync outbox / BullMQ (no-op si neo4jEnabled=false). */
  @Prop({ type: Boolean, default: false, name: 'graph_sync_enabled' })
  graphSyncEnabled: boolean;
}

export type GraphdbSettingsDocument = HydratedDocument<GraphdbSettingsModel>;

export const GraphdbSettingsSchema =
  SchemaFactory.createForClass(GraphdbSettingsModel);
