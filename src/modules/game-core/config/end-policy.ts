export enum EndResolution {
  MANUAL_HOST = 'MANUAL_HOST',
  AUTOMATIC = 'AUTOMATIC',
}

/** Placeholder — conditions are unused in v0 (MANUAL_HOST always empty) */
export interface EndCondition {
  type: string;
  params: unknown;
}

export interface EndPolicy {
  resolution: EndResolution;
  conditions: EndCondition[];
}
