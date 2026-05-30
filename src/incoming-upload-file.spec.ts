import {
  prepareIncomingUploadFile,
  isGzipBuffer,
} from './incoming-upload-file';
import zlib from 'zlib';

describe('incoming-upload-file', () => {
  it('detects gzip magic', () => {
    const raw = Buffer.from('hello');
    const gz = zlib.gzipSync(raw);
    expect(isGzipBuffer(gz)).toBe(true);
    expect(isGzipBuffer(raw)).toBe(false);
  });

  it('gunzips multipart file', () => {
    const raw = Buffer.from('fake-image');
    const gz = zlib.gzipSync(raw);
    const file = {
      fieldname: 'image',
      originalname: 'photo.jpg',
      encoding: '7bit',
      mimetype: 'application/gzip',
      buffer: gz,
      size: gz.length,
    } as Express.Multer.File;

    const out = prepareIncomingUploadFile(file);
    expect(out.buffer.equals(raw)).toBe(true);
    expect(out.mimetype).toBe('image/jpeg');
    expect(out.originalname).toBe('photo.jpg');
  });
});
