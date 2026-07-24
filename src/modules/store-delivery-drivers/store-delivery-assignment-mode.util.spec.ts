import { StoreDeliveryAssignmentModeEnum } from '@schemas/store.schema';
import {
  allowsCourierSelfClaim,
  normalizeStoreDeliveryAssignmentMode,
  resolveMarkReadyAssignmentAction,
  usesHardAutoAssign,
  usesOfferCascade,
} from './store-delivery-assignment-mode.util';

describe('store-delivery-assignment-mode.util', () => {
  it('normalize — AUTO / SEMI_AUTO / MANUAL', () => {
    expect(normalizeStoreDeliveryAssignmentMode('AUTO')).toBe(
      StoreDeliveryAssignmentModeEnum.AUTO,
    );
    expect(normalizeStoreDeliveryAssignmentMode('semi_auto')).toBe(
      StoreDeliveryAssignmentModeEnum.SEMI_AUTO,
    );
    expect(normalizeStoreDeliveryAssignmentMode('MANUAL')).toBe(
      StoreDeliveryAssignmentModeEnum.MANUAL,
    );
  });

  it('normalize — défaut et inconnu → SEMI_AUTO', () => {
    expect(normalizeStoreDeliveryAssignmentMode(undefined)).toBe(
      StoreDeliveryAssignmentModeEnum.SEMI_AUTO,
    );
    expect(normalizeStoreDeliveryAssignmentMode('')).toBe(
      StoreDeliveryAssignmentModeEnum.SEMI_AUTO,
    );
    expect(normalizeStoreDeliveryAssignmentMode('FOO')).toBe(
      StoreDeliveryAssignmentModeEnum.SEMI_AUTO,
    );
  });

  it('claim seulement SEMI_AUTO', () => {
    expect(allowsCourierSelfClaim('SEMI_AUTO')).toBe(true);
    expect(allowsCourierSelfClaim('AUTO')).toBe(false);
    expect(allowsCourierSelfClaim('MANUAL')).toBe(false);
  });

  it('cascade seulement SEMI_AUTO', () => {
    expect(usesOfferCascade('SEMI_AUTO')).toBe(true);
    expect(usesOfferCascade('AUTO')).toBe(false);
    expect(usesOfferCascade('MANUAL')).toBe(false);
  });

  it('hard-assign seulement AUTO', () => {
    expect(usesHardAutoAssign('AUTO')).toBe(true);
    expect(usesHardAutoAssign('SEMI_AUTO')).toBe(false);
    expect(usesHardAutoAssign('MANUAL')).toBe(false);
  });

  it('mark-ready : action système par mode', () => {
    expect(resolveMarkReadyAssignmentAction('AUTO')).toBe('hard_auto');
    expect(resolveMarkReadyAssignmentAction('SEMI_AUTO')).toBe('cascade');
    expect(resolveMarkReadyAssignmentAction('MANUAL')).toBe('none');
  });
});
