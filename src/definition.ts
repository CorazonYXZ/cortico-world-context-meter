import { join, resolve } from 'node:path';
import type { WorldDefinition } from 'cortico/world.ts';
import { CONTEXT_METER_DEFAULTS, type ContextMeterConfig } from './config.ts';
import { ContextMeterWorld } from './world.ts';
export const CONTEXT_METER:WorldDefinition<ContextMeterConfig>={
  id:'context-meter',label:'token计数',
  defaults:()=>({...CONTEXT_METER_DEFAULTS}),
  create:ctx=>new ContextMeterWorld({
    cfg:ctx.cfg,
    directory:resolve(process.env.CORTICO_EXTENSIONS_DIR?.trim() || join(ctx.repoRoot,'extensions')),
    dataDir:ctx.dataDir,
    persist:profile=>ctx.persist({profile}),
  }),
  describe:{tools:[],events:[]},
};
