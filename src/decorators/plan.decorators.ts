import { SetMetadata } from '@nestjs/common';
import { Feature } from '@tokenizer/shared/types';

export const FEATURE_KEY = 'access:features';

export const RequiresFeature = (...features: Feature[]) =>
  SetMetadata(FEATURE_KEY, features);
