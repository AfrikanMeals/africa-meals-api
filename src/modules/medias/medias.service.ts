import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { App } from 'firebase-admin/app';
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

/**
 * Firebase Storage service for image and file uploads.
 * Uses Firebase Admin SDK (service account) so uploads are not blocked by Storage security rules.
 * Requires AM_FIREBASE_STORAGE_BUCKET (ou bucket dérivé du project id) et
 * GOOGLE_APPLICATION_CREDENTIALS ou AM_FIREBASE_SERVICE_ACCOUNT_JSON.
 */
@Injectable()
export class MediasService {
  @Inject('FIREBASE_ADMIN') private readonly _firebaseAdmin: App;
  @Inject('FIREBASE_STORAGE_BUCKET') private readonly _bucketName: string;

  private get bucket() {
    return getStorage(this._firebaseAdmin).bucket(this._bucketName);
  }

  /**
   * Upload a file to Firebase Storage.
   * @param file Multer file from request
   * @param user Current user (stored in metadata)
   * @param basePath Folder path in bucket (e.g. 'users/123/profile')
   * @returns Public download URL
   */
  async upload(file: Express.Multer.File, user: UserModel, basePath = '') {
    try {
      const path =
        basePath.length > 0
          ? `${basePath}/${uuid()}${extname(file.originalname)}`
          : `${uuid()}${extname(file.originalname)}`;
      const fileRef = this.bucket.file(path);
      await fileRef.save(file.buffer, {
        metadata: {
          contentType: file.mimetype,
          metadata: {
            owner: user._id.toString(),
          },
        },
      });
      return await getDownloadURL(fileRef);
    } catch (e) {
      console.error('MediasService.upload', e);
      throw e;
    }
  }

  /**
   * Delete a file from Firebase Storage.
   * @param pathOrUrl Either the object path in the bucket (e.g. 'users/123/profile/abc.jpg')
   *                  or a full Firebase Storage download URL (path will be extracted).
   */
  async delete(pathOrUrl: string) {
    try {
      const path = this.extractPathFromUrl(pathOrUrl);
      const fileRef = this.bucket.file(path);
      return await fileRef.delete();
    } catch (e) {
      console.error('MediasService.delete', e);
      throw e;
    }
  }

  /**
   * Supprime tous les objets sous un préfixe (ex. dossier profil utilisateur).
   * N’émet pas d’erreur (logs seulement) — utile au delete compte / nettoyage.
   */
  async deleteFilesWithPrefix(prefix: string): Promise<void> {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const [files] = await this.bucket.getFiles({ prefix: normalized });
      await Promise.all(
        files.map((f) =>
          f.delete().catch((err: Error) => {
            console.warn(
              `MediasService.deleteFilesWithPrefix skip ${f.name}: ${err?.message}`,
            );
          }),
        ),
      );
    } catch (e) {
      console.error('MediasService.deleteFilesWithPrefix', e);
    }
  }

  /**
   * Supprime tous les fichiers du préfixe sauf `keepPathOrUrl` (chemin objet ou URL de téléchargement).
   * Permet de retirer d’anciennes photos après un nouvel upload si delete(URL) a échoué.
   */
  async deleteFilesWithPrefixExcept(
    prefix: string,
    keepPathOrUrl: string,
  ): Promise<void> {
    const keepPath = this.extractPathFromUrl(keepPathOrUrl);
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      const [files] = await this.bucket.getFiles({ prefix: normalized });
      await Promise.all(
        files
          .filter((f) => f.name !== keepPath)
          .map((f) =>
            f.delete().catch((err: Error) => {
              console.warn(
                `MediasService.deleteFilesWithPrefixExcept skip ${f.name}: ${err?.message}`,
              );
            }),
          ),
      );
    } catch (e) {
      console.error('MediasService.deleteFilesWithPrefixExcept', e);
    }
  }

  /**
   * If the value is a Firebase Storage download URL, extract the object path; otherwise return as-is.
   */
  private extractPathFromUrl(pathOrUrl: string): string {
    try {
      const url = pathOrUrl.trim();
      if (!url.startsWith('http')) return url;
      // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?alt=media&token=...
      const firebaseMatch = url.match(/\/o\/([^?]+)/);
      if (firebaseMatch) {
        return decodeURIComponent(firebaseMatch[1].replace(/\+/g, ' '));
      }
      // https://storage.googleapis.com/<bucket>/<path>
      const gcsMatch = url.match(
        /storage\.googleapis\.com\/[^/]+\/(.+?)(?:\?|$)/,
      );
      if (gcsMatch) {
        return decodeURIComponent(gcsMatch[1].replace(/\+/g, ' '));
      }
    } catch (_) {
      // ignore
    }
    return pathOrUrl;
  }
}
