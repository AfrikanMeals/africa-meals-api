import { ForbiddenException, Injectable } from '@nestjs/common';
import { FoodNewsletterClassifierService } from '@modules/food-newsletter/food-newsletter-classifier.service';
import { FoodNewsletterPlannerService } from '@modules/food-newsletter/food-newsletter-planner.service';
import { PushRecommendationClassifierService } from '@modules/push-recommendations/push-recommendation-classifier.service';
import { PushRecommendationPlannerService } from '@modules/push-recommendations/push-recommendation-planner.service';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

export type ClassifierRunResult = {
  usersProcessed: number;
  candidates: number;
};

export type PlannerRunResult = {
  planned: number;
  delivered: number;
  skipped: number;
};

@Injectable()
export class EngagementAutomationAdminService {
  constructor(
    private readonly pushClassifier: PushRecommendationClassifierService,
    private readonly pushPlanner: PushRecommendationPlannerService,
    private readonly newsletterClassifier: FoodNewsletterClassifierService,
    private readonly newsletterPlanner: FoodNewsletterPlannerService,
  ) {}

  runPushClassifier(user: UserModel): Promise<ClassifierRunResult> {
    assertAdmin(user);
    return this.pushClassifier.runClassifierPass();
  }

  runPushPlanner(user: UserModel): Promise<PlannerRunResult> {
    assertAdmin(user);
    return this.pushPlanner.runPlannerPass();
  }

  runNewsletterClassifier(user: UserModel): Promise<ClassifierRunResult> {
    assertAdmin(user);
    return this.newsletterClassifier.runClassifierPass();
  }

  runNewsletterPlanner(user: UserModel): Promise<PlannerRunResult> {
    assertAdmin(user);
    return this.newsletterPlanner.runPlannerPass();
  }
}
