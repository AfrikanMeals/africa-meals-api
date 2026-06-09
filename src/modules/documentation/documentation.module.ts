import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentationGroupModel,
  DocumentationGroupSchema,
  DocumentationSubjectModel,
  DocumentationSubjectSchema,
  DocumentationTopicModel,
  DocumentationTopicSchema,
} from '@schemas/documentation.schema';
import { DocumentationController } from './documentation.controller';
import { DocumentationService } from './documentation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentationGroupModel.name, schema: DocumentationGroupSchema },
      { name: DocumentationTopicModel.name, schema: DocumentationTopicSchema },
      {
        name: DocumentationSubjectModel.name,
        schema: DocumentationSubjectSchema,
      },
    ]),
  ],
  controllers: [DocumentationController],
  providers: [DocumentationService],
  exports: [DocumentationService],
})
export class DocumentationModule {}
