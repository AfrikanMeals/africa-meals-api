import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProfileImageJsonDto } from './dto/auth.dto';
import {
  decodeProfileImageBase64,
  isAllowedProfileImageFilename,
  profileImageMimeFromFilename,
} from './profile-image-json.util';

describe('ProfileImageJsonDto / decode', () => {
  it('accepte imageBase64 + filename', () => {
    const dto = plainToInstance(ProfileImageJsonDto, {
      imageBase64: Buffer.from('hello').toString('base64'),
      filename: 'photo.jpg',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejette imageBase64 vide', () => {
    const dto = plainToInstance(ProfileImageJsonDto, {
      imageBase64: '',
      filename: 'photo.jpg',
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('decode data-url prefix', () => {
    const b64 = Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
    const buf = decodeProfileImageBase64(`data:image/jpeg;base64,${b64}`);
    expect(buf.equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  });

  it('autorise jpg/png/webp', () => {
    expect(isAllowedProfileImageFilename('a.JPG')).toBe(true);
    expect(isAllowedProfileImageFilename('a.png')).toBe(true);
    expect(isAllowedProfileImageFilename('a.webp')).toBe(true);
    expect(isAllowedProfileImageFilename('a.gif')).toBe(false);
  });

  it('mime depuis filename', () => {
    expect(profileImageMimeFromFilename('x.PNG')).toBe('image/png');
    expect(profileImageMimeFromFilename('x.webp')).toBe('image/webp');
    expect(profileImageMimeFromFilename('x.jpg')).toBe('image/jpeg');
  });
});
