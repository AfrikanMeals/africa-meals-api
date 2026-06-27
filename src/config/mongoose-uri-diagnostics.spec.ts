import { Logger } from '@nestjs/common';
import {
  normalizeMongoUriForDriver,
  warnMongoUriReplicaSetConfig,
} from './mongoose-uri-diagnostics';

describe('warnMongoUriReplicaSetConfig', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delete process.env.MONGODB_URI_DIAGNOSTICS;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('ne warn pas pour Atlas mongodb+srv', () => {
    warnMongoUriReplicaSetConfig(
      'mongodb+srv://u:p@cluster.mongodb.net/db?retryWrites=true',
      'test-api',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warn si self-hosted local sans replicaSet', () => {
    warnMongoUriReplicaSetConfig(
      'mongodb://u:p@127.0.0.1:27017/wise_eat_db?authSource=admin',
      'test-api',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sans replicaSet'),
    );
  });

  it('warn si Stunnel avec directConnection', () => {
    warnMongoUriReplicaSetConfig(
      'mongodb://u:p@db.wise-eat.com:27018/wise_eat_db?authSource=admin&tls=true&directConnection=true',
      'test-api',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stunnel'),
    );
  });

  it('ne warn pas si local avec replicaSet=rs0', () => {
    warnMongoUriReplicaSetConfig(
      'mongodb://u:p@127.0.0.1:27017/wise_eat_db?authSource=admin&replicaSet=rs0',
      'test-api',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ne warn pas si k8s local avec replicaSet=rs0', () => {
    warnMongoUriReplicaSetConfig(
      'mongodb://u:p@host.k3s.internal:27017,host.k3s.internal:27027,host.k3s.internal:27028/wise_eat_db?authSource=admin&replicaSet=rs0',
      'test-api',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('respecte MONGODB_URI_DIAGNOSTICS=0', () => {
    process.env.MONGODB_URI_DIAGNOSTICS = '0';
    warnMongoUriReplicaSetConfig(
      'mongodb://u:p@127.0.0.1:27017/db?authSource=admin',
      'test-api',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('normalizeMongoUriForDriver', () => {
  it('ajuste URI Stunnel (tls, directConnection, sans replicaSet)', () => {
    const raw =
      'mongodb://u:p@db.wise-eat.com:27018/wise_eat_db?authSource=admin&replicaSet=rs0&retryWrites=true&w=majority';
    const normalized = normalizeMongoUriForDriver(raw);
    expect(normalized).toContain('tls=true');
    expect(normalized).toContain('directConnection=true');
    expect(normalized).not.toContain('replicaSet');
    expect(normalized).toContain('retryWrites=true');
  });

  it('ne modifie pas URI rs0 k8s (host.k3s.internal ports locaux)', () => {
    const raw =
      'mongodb://u:p@host.k3s.internal:27017,host.k3s.internal:27027,host.k3s.internal:27028/wise_eat_db?authSource=admin&replicaSet=rs0&retryWrites=true&w=majority';
    expect(normalizeMongoUriForDriver(raw)).toBe(raw);
  });

  it('ne modifie pas Atlas mongodb+srv', () => {
    const raw =
      'mongodb+srv://u:p@cluster.mongodb.net/db?retryWrites=true';
    expect(normalizeMongoUriForDriver(raw)).toBe(raw);
  });
});
