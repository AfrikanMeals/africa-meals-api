import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SecretManagerScopeModel,
  SecretManagerScopeSchema,
} from '@schemas/secret-manager.schema';
import { SecretManagerController } from './secret-manager.controller';
import { SecretManagerService } from './secret-manager.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: SecretManagerScopeModel.name,
        schema: SecretManagerScopeSchema,
      },
    ]),
  ],
  controllers: [SecretManagerController],
  providers: [SecretManagerService],
  exports: [SecretManagerService],
})
export class SecretManagerModule {}
