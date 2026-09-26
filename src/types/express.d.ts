import { User } from '@entities/user.entity';

declare module 'express' {
  interface Request {
    user: Optional<User>;
  }
}

declare module 'express-session' {
  interface SessionData {
    rolling?: boolean;
    absoluteExpiresAt?: number;
    createdAt?: number;
    lastSeenAt?: number;
    userAgent?: string;
    ip?: string;
    location?: {
      city: Nullable<string>;
      region: Nullable<string>;
      country: Nullable<string>;
    };
  }
}
