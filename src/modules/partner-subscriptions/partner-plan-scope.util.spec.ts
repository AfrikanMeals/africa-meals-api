import { Types } from 'mongoose';
import {
  isCustomPartnerPlan,
  partnerActivePlansMongoFilter,
  partnerPlanVisibleToUser,
} from './partner-plan-scope.util';

describe('partnerPlanVisibleToUser', () => {
  it('autorise les plans globaux', () => {
    expect(
      partnerPlanVisibleToUser({
        partnerUserId: null,
        viewerUserId: 'a'.repeat(24),
      }),
    ).toBe(true);
  });

  it('autorise le plan custom du partenaire concerné seulement', () => {
    const id = new Types.ObjectId().toHexString();
    expect(
      partnerPlanVisibleToUser({ partnerUserId: id, viewerUserId: id }),
    ).toBe(true);
    expect(
      partnerPlanVisibleToUser({
        partnerUserId: id,
        viewerUserId: new Types.ObjectId().toHexString(),
      }),
    ).toBe(false);
  });
});

describe('partnerActivePlansMongoFilter', () => {
  it('inclut globaux + partnerUserId viewer', () => {
    const id = new Types.ObjectId().toHexString();
    const f = partnerActivePlansMongoFilter(id);
    expect(f.active).toBe(true);
    expect(Array.isArray(f.$or)).toBe(true);
    expect((f.$or as unknown[]).length).toBe(3);
  });
});

describe('isCustomPartnerPlan', () => {
  it('détecte un scope partner', () => {
    expect(isCustomPartnerPlan(null)).toBe(false);
    expect(isCustomPartnerPlan(new Types.ObjectId())).toBe(true);
  });
});
