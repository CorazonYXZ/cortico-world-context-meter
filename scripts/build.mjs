import {build} from 'esbuild';
import {resolve} from 'node:path';
import {rm} from 'node:fs/promises';
await build({absWorkingDir:resolve(import.meta.dirname,'..'),entryPoints:['src/webui/client.ts'],
  outdir:'dist',entryNames:'webui',bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'info'});
await rm(resolve(import.meta.dirname,'../dist/xlsx-worker.js'),{force:true});
await build({absWorkingDir:resolve(import.meta.dirname,'..'),entryPoints:['src/runtime/worker.ts'],
  outfile:'dist/observer-worker.mjs',bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'info'});
await build({absWorkingDir:resolve(import.meta.dirname,'..'),entryPoints:['src/excel/worker.ts'],
  outfile:'dist/xlsx-export-worker.mjs',bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'info'});
