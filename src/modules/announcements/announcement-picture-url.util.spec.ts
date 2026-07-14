import { applyAnnouncementPictureUrl } from './announcement-picture-url.util';

describe('applyAnnouncementPictureUrl', () => {
  it('persists a trimmed URL', () => {
    expect(applyAnnouncementPictureUrl('  https://cdn.example/ann.jpg  ')).toBe(
      'https://cdn.example/ann.jpg',
    );
  });

  it('clears image when null or empty', () => {
    expect(applyAnnouncementPictureUrl(null)).toBeNull();
    expect(applyAnnouncementPictureUrl('')).toBeNull();
    expect(applyAnnouncementPictureUrl('   ')).toBeNull();
  });
});
