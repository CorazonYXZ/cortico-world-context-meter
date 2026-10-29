import {mkdir, copyFile, writeFile, symlink, lstat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
const framework=dirname(require.resolve('cortico/package.json'));
const stage=join(root,'.validation');
await mkdir(join(stage,'scripts'),{recursive:true});
await writeFile(join(stage,'package.json'),'{"type":"module"}\n');
async function link(target,path){
  try {await lstat(path);} catch(error) {
    if(error.code!=='ENOENT')throw error;
    await symlink(target,path,process.platform==='win32'?'junction':'dir');
  }
}
await link(join(framework,'src'),join(stage,'src'));
await link(join(root,'node_modules'),join(stage,'node_modules'));
for(const file of ['extension-check.ts','extension-describe.ts'])await copyFile(join(root,'scripts/upstream',file),join(stage,'scripts',file));
const command=process.argv.includes('--describe')?'extension-describe.ts':'extension-check.ts';
const result=spawnSync(process.execPath,['--import',pathToFileURL(require.resolve('tsx')).href,join(stage,'scripts',command),root],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status ?? 1;
