import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,bundleInputs} from './bundle-inputs.mjs';
const cli=process.env.npm_execpath;
if(!cli||!isAbsolute(cli))throw new Error('Run this check with pnpm check:security.');
const directory=join(root,'.validation');await mkdir(directory,{recursive:true});
const config=join(directory,'security-empty.npmrc');await writeFile(config,'');
function pnpm(args){
  const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,
    env:{...process.env,NPM_CONFIG_USERCONFIG:config,npm_config_userconfig:config}});
  if(result.error||result.signal)throw new Error('Security query could not run.');
  let value;try{value=JSON.parse(result.stdout);}catch{throw new Error('Security query returned no valid JSON.');}
  return {value,status:result.status};
}
const audits={};
for(const [scope,args] of [['production',['--prod']],['all',[]]]){
  const {value,status}=pnpm(['audit',...args,'--json','--registry=https://registry.npmjs.org']);
  await writeFile(join(directory,`security-audit-${scope}.json`),JSON.stringify(value,null,2)+'\n');
  const counts=value.metadata?.vulnerabilities;
  if(!counts||!['info','low','moderate','high','critical'].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0))throw new Error('Vulnerability query incomplete.');
  if(status!==0||Object.values(counts).some(n=>n!==0))throw new Error(`Unresolved ${scope} dependency advisories. See local validation report.`);
  audits[scope]={vulnerabilities:counts,totalDependencies:value.metadata.totalDependencies};
}
const {value:installed,status}=pnpm(['list','--depth','Infinity','--json']);if(status!==0)throw new Error('Dependency inventory unavailable.');
function inspect(value){
  if(!value||typeof value!=='object')return;
  for(const [name,child] of Object.entries(value)){
    if(['buffers','binary','tinypool'].includes(name))throw new Error('Removed dependency remains in the installed graph.');
    if(name==='uuid'&&child&&typeof child==='object'&&child.version!=='11.1.1')throw new Error('Unexpected installed UUID version.');
    inspect(child);
  }
}
inspect(installed);
const bundle=await bundleInputs(),publicRecord=JSON.parse(await readFile(join(root,'provenance/excel-bundle.json'),'utf8'));
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const sha=await hash(join(root,'dist/xlsx-export-worker.mjs'));
if(publicRecord.sha256!==sha||JSON.stringify(publicRecord.sources)!==JSON.stringify(bundle.sources))throw new Error('Bundle provenance is stale.');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const report={extensionVersion:pkg.version,checkedAt:new Date().toISOString(),registry:'https://registry.npmjs.org',
  note:'Known-advisory results at this time, not security certification. All dependencies include the actual bundled Excel code.',
  audits,lockfileSha256:await hash(join(root,'pnpm-lock.yaml')),excelWorkerSha256:sha,
  bundledPackages:bundle.packages.size,bundledSources:bundle.sources.length,externalImports:'Node built-ins only',
  legacyBuffersBinaryTinypoolAbsent:true,oldExcelBrowserDistributionAbsent:true};
await writeFile(join(root,'provenance/security-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
