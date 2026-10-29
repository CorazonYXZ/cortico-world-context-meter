import {build} from 'esbuild';
import {resolve} from 'node:path';
import {rm,mkdir,writeFile} from 'node:fs/promises';
await build({absWorkingDir:resolve(import.meta.dirname,'..'),entryPoints:['src/webui/client.ts'],
  outdir:'dist',entryNames:'webui',bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'info'});
await rm(resolve(import.meta.dirname,'../dist/xlsx-worker.js'),{force:true});
await build({absWorkingDir:resolve(import.meta.dirname,'..'),entryPoints:['src/runtime/worker.ts'],
  outfile:'dist/observer-worker.mjs',bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'info'});
const excel=await build({absWorkingDir:resolve(import.meta.dirname,'..'),entryPoints:['src/excel/worker.ts'],
  outfile:'dist/xlsx-export-worker.mjs',bundle:true,format:'esm',platform:'node',target:'node22',metafile:true,logLevel:'info',
  alias:{'@aws-sdk/client-s3':resolve(import.meta.dirname,'../src/excel/no-cloud.cjs')},
  banner:{js:"import {createRequire as __excelCreateRequire} from 'node:module'; const require=__excelCreateRequire(import.meta.url);"}});
await mkdir(resolve(import.meta.dirname,'../.validation'),{recursive:true});
await writeFile(resolve(import.meta.dirname,'../.validation/xlsx-metafile.json'),JSON.stringify(excel.metafile,null,2)+'\n');
