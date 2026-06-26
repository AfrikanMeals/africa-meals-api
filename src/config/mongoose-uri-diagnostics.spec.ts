import { Logger } from '@nestjs/common';
import { warnMongoUriReplicaSetConfig } from './mongoose-uri-diagnostics';

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

  it('respecte MONGODB_URI_DIAGNOSTICS=0', () => {
    process.env.MONGODB_URI_DIAGNOSTICS = '0';
    warnMongoUriReplicaSetConfig(
      'mongodb://u:p@127.0.0.1:27017/db?authSource=admin',
      'test-api',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
