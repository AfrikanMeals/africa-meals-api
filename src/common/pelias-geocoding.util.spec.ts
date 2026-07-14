import { peliasForwardGeocode, resolvePeliasBaseUrl } from './pelias-geocoding.util';

describe('pelias-geocoding.util', () => {
  it('resolvePeliasBaseUrl trim slash', () => {
    const prev = process.env.PELIAS_BASE_URL;
    process.env.PELIAS_BASE_URL = 'http://localhost:4000/';
    expect(resolvePeliasBaseUrl()).toBe('http://localhost:4000');
    if (prev === undefined) delete process.env.PELIAS_BASE_URL;
    else process.env.PELIAS_BASE_URL = prev;
  });

  it('forward sans base → []', async () => {
    const prev = process.env.PELIAS_BASE_URL;
    delete process.env.PELIAS_BASE_URL;
    await expect(
      peliasForwardGeocode({ query: 'Montreal' }),
    ).resolves.toEqual([]);
    if (prev !== undefined) process.env.PELIAS_BASE_URL = prev;
  });
});
