import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { FirebaseApp } from 'firebase/app';
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

@Injectable()
export class MediasService {
  @Inject('FIREBASE') private readonly _firebase: FirebaseApp;

  async upload(file: Express.Multer.File, user: UserModel, basePath = '') {
    try {
      const storage = getStorage();
      // console.log('🚀 ~ MediasService ~ upload ~ storage:', storage);

      const fileRef = ref(
        storage,
        `${basePath}/${uuid()}${extname(file.originalname)}`,
      );
      const result = await uploadBytesResumable(fileRef, file.buffer, {
        contentType: file.mimetype,
        customMetadata: {
          owner: user._id.toString(),
        },
      });

      if (!result) {
        throw new BadRequestException('file_upload_failed');
      }

      // console.log('🚀 ~ MediasService ~ upload ~ result:', result);
      return getDownloadURL(fileRef);
    } catch (e) {
      console.log('🚀 ~ MediasService ~ upload ~ e:', e);
      throw e;
    }
  }
}
