import type { Express } from 'express';
import { assertUploadFileSignature, detectUploadFileKind } from './upload-file-signature.util';

describe('upload-file-signature.util', () => {
  it('détecte JPEG', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectUploadFileKind(buf)).toBe('jpeg');
  });

  it('rejette une extension non autorisée', () => {
    expect(() =>
      assertUploadFileSignature({
        fieldname: 'file',
        originalname: 'evil.exe',
        encoding: '7bit',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        size: 4,
      } as Express.Multer.File),
    ).toThrow('invalid_file_extension');
  });

  it('accepte un PNG cohérent', () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(() =>
      assertUploadFileSignature({
        fieldname: 'file',
        originalname: 'photo.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: pngHeader,
        size: pngHeader.length,
      } as Express.Multer.File),
    ).not.toThrow();
  });
});
