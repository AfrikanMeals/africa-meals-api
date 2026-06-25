import { parseGrpcVersion, grpcVersionAtLeast } from '@africa-meals/proto';

describe('parseGrpcVersion', () => {
  it('default à 1', () => {
    expect(parseGrpcVersion(undefined)).toBe(1);
  });

  it('clamp entre 1 et 3', () => {
    expect(parseGrpcVersion('0')).toBe(1);
    expect(parseGrpcVersion('99')).toBe(3);
    expect(parseGrpcVersion('2')).toBe(2);
  });

  it('grpcVersionAtLeast', () => {
    expect(grpcVersionAtLeast(parseGrpcVersion('1'), 1)).toBe(true);
    expect(grpcVersionAtLeast(parseGrpcVersion('1'), 2)).toBe(false);
    expect(grpcVersionAtLeast(parseGrpcVersion('3'), 2)).toBe(true);
  });
});
