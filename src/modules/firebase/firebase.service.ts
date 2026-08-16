import { ConfigService } from '@modules/config/config.service';
import * as Types from '@modules/firebase/firebase.types';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  cert,
  deleteApp,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

@Injectable()
export class FirebaseService implements OnModuleDestroy {
  public readonly app: Types.FirebaseApp;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly configService: ConfigService) {
    this.app = getApps().length
      ? getApp()
      : initializeApp({
          credential: cert({
            projectId: this.configService.get('FIREBASE_PROJECT_ID'),
            clientEmail: this.configService.get('FIREBASE_CLIENT_EMAIL'),
            privateKey: this.configService.get('FIREBASE_PRIVATE_KEY'),
          }),
          storageBucket: this.configService.get('FIREBASE_STORAGE_BUCKET'),
        });
  }

  public get storage(): Types.Storage {
    return getStorage(this.app);
  }

  /** Defaults to the bucket configured via `FIREBASE_STORAGE_BUCKET`. */
  public bucket(name?: string): Types.Bucket {
    return this.storage.bucket(name);
  }

  async onModuleDestroy(): Promise<void> {
    if (getApps().includes(this.app)) {
      await deleteApp(this.app);
    }
  }
}
