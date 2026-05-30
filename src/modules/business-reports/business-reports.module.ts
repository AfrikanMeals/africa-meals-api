import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BusinessStoreReportModel,
  BusinessStoreReportSchema,
} from '@schemas/business-store-report.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { BusinessReportsAdminController } from './business-reports-admin.controller';
import { BusinessReportsService } from './business-reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: BusinessStoreReportModel.name,
        schema: BusinessStoreReportSchema,
      },
      { name: OrderModel.name, schema: OrderSchema },
    ]),
  ],
  controllers: [BusinessReportsAdminController],
  providers: [BusinessReportsService],
  exports: [BusinessReportsService],
})
export class BusinessReportsModule {}
