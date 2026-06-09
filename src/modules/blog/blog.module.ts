import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BlogArticleModel,
  BlogArticleSchema,
  BlogGroupModel,
  BlogGroupSchema,
} from '@schemas/blog.schema';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlogGroupModel.name, schema: BlogGroupSchema },
      { name: BlogArticleModel.name, schema: BlogArticleSchema },
    ]),
  ],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
