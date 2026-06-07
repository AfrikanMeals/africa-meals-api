import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DashboardAuditLogModel,
  DashboardAuditLogSchema,
} from '@schemas/dashboard-audit-log.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import {
  ProductCategoryModel,
  ProductCategorySchema,
} from '@schemas/product-category.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  StoreCouponModel,
  StoreCouponSchema,
} from '@schemas/store_coupon.schema';
import { DashboardAuditController } from './dashboard-audit.controller';
import { DashboardAuditInterceptor } from './dashboard-audit.interceptor';
import { DashboardAuditResourceResolver } from './dashboard-audit-resource.resolver';
import { DashboardAuditService } from './dashboard-audit.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      {
        name: DashboardAuditLogModel.name,
        schema: DashboardAuditLogSchema,
      },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: ProductCategoryModel.name, schema: ProductCategorySchema },
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
    ]),
  ],
  controllers: [DashboardAuditController],
  providers: [
    DashboardAuditService,
    DashboardAuditResourceResolver,
    DashboardAuditInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: DashboardAuditInterceptor,
    },
  ],
  exports: [DashboardAuditService],
})
export class DashboardAuditModule {}
