import {
  distanceMetersBetweenPoints,
  formatDistanceMetersLabel,
  inferProofPhotoMimeFromFilename,
  isAllowedProofPhotoMime,
  isMeaningfulGeoCoordinate,
  multerFileFromProofPhotoJson,
  proofPhotosJsonToMulterFiles,
  shouldBlockPendingDeliveryResubmit,
} from './pending-delivery.util';

describe('pending-delivery.util', () => {
  describe('isMeaningfulGeoCoordinate', () => {
    it('rejette origine nulle et coordonnées invalides', () => {
      expect(isMeaningfulGeoCoordinate(0, 0)).toBe(false);
      expect(isMeaningfulGeoCoordinate(91, 0)).toBe(false);
      expect(isMeaningfulGeoCoordinate(Number.NaN, 2)).toBe(false);
    });

    it('accepte des coordonnées valides', () => {
      expect(isMeaningfulGeoCoordinate(45.5017, -73.5673)).toBe(true);
    });
  });

  describe('distanceMetersBetweenPoints', () => {
    it('calcule une distance proche de zéro pour le même point', () => {
      const meters = distanceMetersBetweenPoints({
        fromLat: 3.848,
        fromLng: 11.502,
        toLat: 3.848,
        toLng: 11.502,
      });
      expect(meters).toBe(0);
    });

    it('retourne une distance positive entre deux points distincts', () => {
      const meters = distanceMetersBetweenPoints({
        fromLat: 45.5017,
        fromLng: -73.5673,
        toLat: 45.5088,
        toLng: -73.554,
      });
      expect(meters).toBeGreaterThan(500);
      expect(meters).toBeLessThan(2000);
    });
  });

  describe('formatDistanceMetersLabel', () => {
    it('formate en mètres ou kilomètres', () => {
      expect(formatDistanceMetersLabel(450)).toBe('450 m');
      expect(formatDistanceMetersLabel(1500)).toBe('1.5 km');
      expect(formatDistanceMetersLabel(-1)).toBe('—');
    });
  });

  describe('proofPhotosJsonToMulterFiles', () => {
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    it('décode une photo base64 valide', () => {
      const [file] = proofPhotosJsonToMulterFiles(
        [
          {
            fileBase64: tinyPngBase64,
            filename: 'proof.png',
          },
        ],
        1024 * 1024,
      );
      expect(file.mimetype).toBe('image/png');
      expect(file.buffer.length).toBeGreaterThan(0);
      expect(file.fieldname).toBe('proofPhotos');
    });

    it('accepte le préfixe data:image', () => {
      const file = multerFileFromProofPhotoJson(
        {
          fileBase64: `data:image/png;base64,${tinyPngBase64}`,
          filename: 'proof.png',
        },
        1024 * 1024,
      );
      expect(file.mimetype).toBe('image/png');
    });

    it('rejette base64 invalide ou vide', () => {
      expect(() =>
        multerFileFromProofPhotoJson(
          { fileBase64: '%%%', filename: 'proof.jpg' },
          1024,
        ),
      ).toThrow('empty_image');
    });

    it('infère le mime depuis le nom de fichier', () => {
      expect(inferProofPhotoMimeFromFilename('proof.jpg')).toBe('image/jpeg');
      expect(isAllowedProofPhotoMime('image/webp')).toBe(true);
      expect(isAllowedProofPhotoMime('application/pdf')).toBe(false);
    });
  });

  describe('shouldBlockPendingDeliveryResubmit', () => {
    it('autorise resoumission livreur assigné si commande encore shipped', () => {
      expect(
        shouldBlockPendingDeliveryResubmit({
          orderStatus: 'shipped',
          existingProofStatus: 'submitted',
          assignedAgentVerified: true,
        }),
      ).toBe(false);
    });

    it('autorise resoumission si même livreur sur la preuve', () => {
      expect(
        shouldBlockPendingDeliveryResubmit({
          orderStatus: 'shipped',
          existingProofStatus: 'submitted',
          sameDeliveryAgent: true,
        }),
      ).toBe(false);
    });

    it('bloque si autre livreur sans assignation vérifiée', () => {
      expect(
        shouldBlockPendingDeliveryResubmit({
          orderStatus: 'shipped',
          existingProofStatus: 'submitted',
          sameDeliveryAgent: false,
        }),
      ).toBe(true);
    });

    it('autorise nouvelle preuve après rejet admin', () => {
      expect(
        shouldBlockPendingDeliveryResubmit({
          orderStatus: 'shipped',
          existingProofStatus: 'admin_rejected',
          sameDeliveryAgent: true,
        }),
      ).toBe(false);
    });
  });
});
