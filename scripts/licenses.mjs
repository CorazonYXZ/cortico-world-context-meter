// Input: pnpm --config.store-dir=../.tooling/pnpm-store licenses list --prod --json
import {readFile,readdir,writeFile,realpath,copyFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const root=resolve(import.meta.dirname,'..'),modules=await realpath(join(root,'node_modules'));
const groups=JSON.parse(await readFile(join(root,'.validation/production-licenses.json'),'utf8'));
const browserMap=JSON.parse(await readFile(join(root,'node_modules/exceljs/dist/exceljs.js.map'),'utf8'));
const seen=new Set();
const records=[],notices=['Production dependency licenses. Source versions and repositories: provenance/production-dependencies.json.\nJSZip: the MIT licensing option is selected.\n'];
for(const packages of Object.values(groups))for(const p of packages)for(const dependencyPath of p.paths){
  const directory=await realpath(dependencyPath);if(!directory.startsWith(modules+sep))throw new Error('Dependency path outside project.');
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  const identity=`${p.name}@${manifest.version}`;if(seen.has(identity))continue;seen.add(identity);
  const source=typeof manifest.repository==='string'?manifest.repository:manifest.repository?.url??p.homepage??null;
  const record={name:p.name,versions:[manifest.version],license:p.license,repository:source,registry:`https://registry.npmjs.org/${encodeURIComponent(p.name)}`,
    bundledInExcelWorker:p.name==='exceljs'||browserMap.sources.some(s=>s.includes(`node_modules/${p.name}/`)),licenseFiles:[]};
  notices.push(`\n===== ${identity} — ${p.license} =====\nSource: ${source??record.registry}\nAuthor: ${typeof manifest.author==='string'?manifest.author:manifest.author?.name??'See upstream notices'}\n`);
  for(const file of (await readdir(directory)).filter(name=>/^(licen[sc]e|copying|notice)([._-].*)?$/i.test(name))){
    const path=join(directory,file);try{notices.push(`--- ${file} ---\n${await readFile(path,'utf8')}\n`);record.licenseFiles.push(file);}catch(error){if(error.code!=='EISDIR')throw error;}
  }
  if(!record.licenseFiles.length){
    for(const file of (await readdir(directory)).filter(name=>/^readme/i.test(name))){
      const text=await readFile(join(directory,file),'utf8'),start=text.search(/(?:^|\n)#{0,3}\s*(?:licen[sc]e|copyright)\b/i);
      if(start>=0){notices.push(`--- ${file}, license section ---\n${text.slice(start)}\n`);record.licenseFiles.push(`${file} (license section)`);}
    }
  }
  if(p.name==='saxes'){
    notices.push(await readFile(join(root,'licenses/saxes-5.0.1-ISC.txt'),'utf8'));record.licenseFiles.push('licenses/saxes-5.0.1-ISC.txt (upstream tag v5.0.1)');
  }
  if(!record.licenseFiles.length)notices.push(`This package archive declares ${p.license} in its metadata but does not include a standalone license text. Bundled in the browser worker: ${record.bundledInExcelWorker}. Do not infer an unspecified license.\n`);
  records.push(record);
}
records.sort((a,b)=>a.name.localeCompare(b.name));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
await writeFile(join(root,'provenance/production-dependencies.json'),JSON.stringify({extensionVersion:pkg.version,dependencies:records},null,2)+'\n');
await writeFile(join(root,'licenses/Production-dependencies.txt'),notices.join('\n'));
await copyFile(join(root,'node_modules/exceljs/LICENSE'),join(root,'licenses/ExcelJS-MIT.txt'));
console.log(JSON.stringify({packages:records.length,licenses:[...new Set(records.map(r=>r.license))],missingLicenseText:records.filter(r=>!r.licenseFiles.length).map(r=>r.name)}));
