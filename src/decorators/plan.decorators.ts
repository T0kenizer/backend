import { SetMetadata } from '@nestjs/common';
import { Feature } from '@tokenizer/shared/types';

export const FEATURE_KEY = 'access:features';

/** Grants access to callers whose plan holds every listed feature. */
export const RequiresFeature = (...features: Feature[]) =>
  SetMetadata(FEATURE_KEY, features);
