// Inventory actual bundled code as well as the installed runtime tokenizer.
import {readFile,readdir,writeFile,realpath,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {root,bundleInputs} from './bundle-inputs.mjs';
const require=createRequire(import.meta.url),bundle=await bundleInputs(),packages=bundle.packages;
let tokenizerDir=dirname(await realpath(require.resolve('@huggingface/tokenizers')));
for(;;){const file=join(tokenizerDir,'package.json');try{const manifest=JSON.parse(await readFile(file,'utf8'));if(manifest.name==='@huggingface/tokenizers'){packages.set(manifest.name+'@'+manifest.version,{directory:tokenizerDir,manifest,bundledInExcelWorker:false,runtimeDependency:true});break;}}catch(e){if(e.code!=='ENOENT')throw e;}const next=dirname(tokenizerDir);if(next===tokenizerDir)throw new Error('Tokenizer package missing.');tokenizerDir=next;}
const records=[],notices=['Runtime and bundled dependency licenses. Versions and repositories: provenance/production-dependencies.json.\nExcel code is rebuilt from the official Node entry and patched dependency tree. JSZip is used under its MIT option.\n'];
for(const [identity,p] of [...packages].sort(([a],[b])=>a.localeCompare(b))){
  const {manifest,directory}=p,license=typeof manifest.license==='string'?manifest.license:'Unknown';
  if(license==='Unknown')throw new Error(`Unclear license: ${identity}`);
  const repository=typeof manifest.repository==='string'?manifest.repository:manifest.repository?.url??manifest.homepage??null;
  const record={name:manifest.name,versions:[manifest.version],license,repository,registry:`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}`,
    bundledInExcelWorker:p.bundledInExcelWorker,runtimeDependency:p.runtimeDependency??false,licenseFiles:[]};
  if(manifest.name==='jszip')record.selectedLicense='MIT';
  notices.push(`\n===== ${identity} — ${license} =====\nSource: ${repository??record.registry}\nAuthor: ${typeof manifest.author==='string'?manifest.author:manifest.author?.name??'See upstream notices'}\n`);
  const files=await readdir(directory);
  for(const name of files.filter(name=>/^(licen[sc]e|copying|notice)([._-].*)?$/i.test(name))){
    try{notices.push(`--- ${name} ---\n${await readFile(join(directory,name),'utf8')}\n`);record.licenseFiles.push(name);}catch(error){if(error.code!=='EISDIR')throw error;}
  }
  if(!record.licenseFiles.length)for(const name of files.filter(name=>/^readme/i.test(name))){
    const text=await readFile(join(directory,name),'utf8'),start=text.search(/(?:^|\n)#{0,3}\s*(?:licen[sc]e|copyright)\b/i);
    if(start>=0){notices.push(`--- ${name}, license section ---\n${text.slice(start)}\n`);record.licenseFiles.push(`${name} (license section)`);}
  }
  if(manifest.name==='saxes'&&manifest.version==='5.0.1'){
    notices.push(await readFile(join(root,'licenses/saxes-5.0.1-ISC.txt'),'utf8'));record.licenseFiles.push('licenses/saxes-5.0.1-ISC.txt (upstream tag v5.0.1)');
  }
  if(!record.licenseFiles.length)throw new Error(`License text unavailable: ${identity}`);
  records.push(record);
}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),bytes=await readFile(join(root,'dist/xlsx-export-worker.mjs'));
await writeFile(join(root,'provenance/production-dependencies.json'),JSON.stringify({extensionVersion:pkg.version,scope:'installed runtime dependency and actual Excel worker build inputs',dependencies:records},null,2)+'\n');
await writeFile(join(root,'provenance/excel-bundle.json'),JSON.stringify({extensionVersion:pkg.version,entry:'exceljs (official Node entry)',file:'dist/xlsx-export-worker.mjs',sha256:createHash('sha256').update(bytes).digest('hex'),externalBuiltins:bundle.imports,sources:bundle.sources},null,2)+'\n');
await writeFile(join(root,'licenses/Production-dependencies.txt'),notices.join('\n'));
await copyFile(join(root,'node_modules/exceljs/LICENSE'),join(root,'licenses/ExcelJS-MIT.txt'));
console.log(JSON.stringify({packages:records.length,bundleSources:bundle.sources.length,licenses:[...new Set(records.map(r=>r.license))],unknownLicenses:0}));
