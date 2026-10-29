import type { Profile } from './types.ts';
export interface ContextMeterConfig { enabled:boolean; profile:Profile; }
export const CONTEXT_METER_DEFAULTS:ContextMeterConfig={enabled:false,profile:'v41'};
