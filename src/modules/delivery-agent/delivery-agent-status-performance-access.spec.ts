import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DeliveryAgentApplicationStatus } from '@schemas/delivery-agent-application.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { DeliveryAgentService } from './delivery-agent.service';

describe('DeliveryAgentService.getStatusPerformanceOverviewForAdmin', () => {
  const applicationId = '507f1f77bcf86cd799439031';
  const courierId = '507f1f77bcf86cd799439032';

  /**
   * Monte le chemin d’accès admin sans initialiser le vaste graphe livraison.
   * Le test vérifie l’ordre des gardes avant toute lecture de données.
   */
  function buildService(
    applicationStatus = DeliveryAgentApplicationStatus.APPROVED,
  ) {
    const findById = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: applicationId,
        user: courierId,
        status: applicationStatus,
      }),
    });
    const buildForAgentUserId = jest.fn().mockResolvedValue({ ok: true });
    const service = Object.create(
      DeliveryAgentService.prototype,
    ) as DeliveryAgentService;

    Object.assign(service, {
      _applications: { findById },
      _statusPerformance: { buildForAgentUserId },
    });

    return { service, findById, buildForAgentUserId };
  }

  it('refuse un non-admin avant de charger la candidature', async () => {
    const { service, findById, buildForAgentUserId } = buildService();
    const vendor = {
      _id: '507f1f77bcf86cd799439033',
      type: UserTypeEnum.VENDOR,
    } as UserModel;

    await expect(
      service.getStatusPerformanceOverviewForAdmin(vendor, applicationId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findById).not.toHaveBeenCalled();
    expect(buildForAgentUserId).not.toHaveBeenCalled();
  });

  it('exige une candidature APPROVED', async () => {
    const { service, buildForAgentUserId } = buildService(
      DeliveryAgentApplicationStatus.AWAITING_REVIEW,
    );
    const admin = {
      _id: '507f1f77bcf86cd799439034',
      type: UserTypeEnum.ADMIN,
    } as UserModel;

    await expect(
      service.getStatusPerformanceOverviewForAdmin(admin, applicationId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buildForAgentUserId).not.toHaveBeenCalled();
  });

  it('active les finances uniquement pour un admin approuvé', async () => {
    const { service, buildForAgentUserId } = buildService();
    const admin = {
      _id: '507f1f77bcf86cd799439034',
      type: UserTypeEnum.ADMIN,
    } as UserModel;

    await service.getStatusPerformanceOverviewForAdmin(admin, applicationId);

    expect(buildForAgentUserId).toHaveBeenCalledWith(courierId, {
      includeFinancials: true,
      maskStripeAccountId: false,
    });
  });
});
