import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep} from 'node:path';
import {builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
export const root=resolve(import.meta.dirname,'..');
const builtin=new Set(builtinModules.flatMap(name=>[name,'node:'+name]));
export async function bundleInputs(){
  const meta=JSON.parse(await readFile(join(root,'.validation/xlsx-metafile.json'),'utf8'));
  const modules=await realpath(join(root,'node_modules')),packages=new Map(),sources=[];
  for(const input of Object.keys(meta.inputs).sort()){
    const path=await realpath(resolve(root,input));
    let publicPath=relative(root,path).replaceAll('\\','/');
    if(path.startsWith(modules+sep)){
      let directory=dirname(path),manifest;
      while(directory.startsWith(modules+sep)){
        try{const value=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(value.name&&value.version){manifest=value;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
        directory=dirname(directory);
      }
      if(!manifest)throw new Error('Missing bundle package metadata.');
      const key=manifest.name+'@'+manifest.version;
      packages.set(key,{directory,manifest,bundledInExcelWorker:true});
      publicPath=key+'/'+relative(directory,path).replaceAll('\\','/');
      if(['buffers','binary'].includes(manifest.name))throw new Error('Removed legacy dependency reappeared in bundle.');
      if(manifest.name==='uuid'&&manifest.version!=='11.1.1')throw new Error('Unexpected bundled UUID version.');
    }else if(publicPath.startsWith('../')||/^[A-Za-z]:/.test(publicPath))throw new Error('Bundle input outside project.');
    if(/^exceljs@[^/]+\/dist\//.test(publicPath)||/exceljs\.min\.js$/.test(publicPath))throw new Error('Old ExcelJS distribution must not be bundled.');
    const bytes=await readFile(path);sources.push({path:publicPath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const imports=[...new Set(Object.values(meta.outputs).flatMap(out=>out.imports.filter(i=>i.external).map(i=>i.path)))].sort();
  if(imports.some(name=>!builtin.has(name)))throw new Error('Excel worker has an external non-builtin dependency.');
  return {packages,sources,imports};
}
