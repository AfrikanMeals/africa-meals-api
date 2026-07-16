import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SitePagesService } from './site-pages.service';
import { UserTypeEnum } from '@schemas/user.schema';

describe('SitePagesService', () => {
  const adminUser = { type: UserTypeEnum.ADMIN } as never;
  const clientUser = { type: UserTypeEnum.USER } as never;

  function makeService(overrides?: {
    findExec?: jest.Mock;
    findOneExec?: jest.Mock;
    findOneAndUpdateExec?: jest.Mock;
  }) {
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: overrides?.findExec ?? jest.fn().mockResolvedValue([]),
    };
    const findOneChain = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: overrides?.findOneExec ?? jest.fn().mockResolvedValue(null),
    };
    const model = {
      find: jest.fn().mockReturnValue(findChain),
      findOne: jest.fn().mockReturnValue(findOneChain),
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec:
          overrides?.findOneAndUpdateExec ??
          jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn(),
    };
    return new SitePagesService(model as never);
  }

  it('refuse listForAdmin aux non-admin', async () => {
    const service = makeService();
    await expect(service.listForAdmin(clientUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('getPublishedPublic 404 si non publié', async () => {
    const service = makeService({
      findExec: jest.fn().mockResolvedValue([]),
    });
    await expect(
      service.getPublishedPublic('vendor', 'fr'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getPublishedPublic mappe le doc publié + localeFallback', async () => {
    const doc = {
      _id: { toString: () => 'abc' },
      slug: 'vendor',
      locale: 'fr',
      title: 'Restaurant',
      metaTitle: 'Meta',
      metaDescription: 'Desc',
      content: { hero: { h1: 'Titre' } },
      isPublished: true,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const service = makeService({
      findExec: jest.fn().mockResolvedValue([doc]),
    });
    const result = await service.getPublishedPublic('vendor', 'en');
    expect(result.locale).toBe('fr');
    expect(result.localeFallback).toBe(true);
    expect(result.content.hero.h1).toBe('Titre');
    expect(result.isPublished).toBe(true);
  });

  it('upsert exige ADMIN et normalise le content', async () => {
    const saved = {
      _id: { toString: () => 'id1' },
      slug: 'vendor',
      locale: 'fr',
      title: 'T',
      metaTitle: '',
      metaDescription: '',
      content: { hero: { h1: 'H' } },
      isPublished: true,
    };
    const service = makeService({
      findOneAndUpdateExec: jest.fn().mockResolvedValue(saved),
    });
    const result = await service.upsert(adminUser, 'vendor', {
      slug: 'vendor',
      locale: 'fr',
      title: 'T',
      content: { hero: { h1: 'H' } },
      isPublished: true,
    });
    expect(result.content.hero.h1).toBe('H');
    expect(result.content.cta.title).toBe('');
  });
});
