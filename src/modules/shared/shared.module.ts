import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp } from 'firebase/app';

@Module({
  providers: [
    {
      provide: 'FIREBASE',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const firebaseConfig = {
          apiKey: config.get<string>('FIREBASE_API_KEY'),
          authDomain: config.get<string>('FIREBASE_AUTH_DOMAIN'),
          projectId: config.get<string>('FIREBASE_PROJECT_ID'),
          storageBucket: config.get<string>('FIREBASE_STORAGE_BUCKET'),
          messagingSenderId: config.get<string>('FIREBASE_MESSAGING_SENDER_ID'),
          appId: config.get<string>('FIREBASE_APP_ID'),
          measurementId: config.get<string>('FIREBASE_MEASUREMENT_ID'),
        };
        // console.log('🚀 ~ firebaseConfig:', firebaseConfig);

        return initializeApp(firebaseConfig);
      },
    },
  ],
  exports: ['FIREBASE'],
})
export class SharedModule {}
