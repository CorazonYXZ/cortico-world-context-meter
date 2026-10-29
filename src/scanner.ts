import { join, resolve } from 'node:path';
import { declarationReader, FileProblem, packageJsonPath, type DeclarationReader } from './files.ts';
import { estimate, object, unavailable, type CountTokens } from './estimate.ts';
import type { ExtensionEstimate, ExtensionKind, Profile, ScanReport } from './types.ts';
const PACKAGE_LIMIT=256*1024;
const DESCRIPTION_LIMIT=4*1024*1024;
const packageName=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export interface ScanOptions { directory:string; profile:Profile; count:CountTokens; reader?:DeclarationReader; }

export async function scan(options: ScanOptions): Promise<ScanReport> {
  const reader=options.reader ?? declarationReader();
  const rows:ExtensionEstimate[]=[];
  let directoryStatus:ScanReport['directoryStatus']='ok';
  let installed:unknown;
  try {
    const directory=await reader.canonical(resolve(options.directory));
    installed=await reader.readJson(await packageJsonPath(reader,directory,'package.json'),PACKAGE_LIMIT);
    if (!object(installed) || (installed.dependencies !== undefined && !object(installed.dependencies))) throw new Error();
  } catch (error) {
    directoryStatus=(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';
    return finish();
  }
  const dependencies=(installed as {dependencies?:Record<string,unknown>}).dependencies ?? {};
  for (const name of Object.keys(dependencies).sort()) {
    if (!packageName.test(name) || typeof dependencies[name] !== 'string') {
      rows.push(unavailable(name,'unknown','invalid_manifest')); continue;
    }
    let kind:ExtensionKind='unknown';
    let packageRoot:string;
    let manifest:unknown;
    try {
      packageRoot=await reader.canonical(join(options.directory,'node_modules',...name.split('/')));
      manifest=await reader.readJson(await packageJsonPath(reader,packageRoot,'package.json'),PACKAGE_LIMIT);
    } catch (error) {
      rows.push(unavailable(name,kind,error instanceof FileProblem ? error.issue : 'manifest_unreadable')); continue;
    }
    if (!object(manifest) || !object(manifest.cortico)) {
      rows.push(unavailable(name,kind,'invalid_manifest')); continue;
    }
    const block=manifest.cortico;
    if (block.kind !== 'world' && block.kind !== 'provider' && block.kind !== 'bot') {
      rows.push(unavailable(name,kind,'invalid_manifest')); continue;
    }
    kind=block.kind;
    if (typeof block.describe !== 'string' || !block.describe) {
      rows.push(unavailable(name,kind,'missing_description')); continue;
    }
    try {
      const path=await packageJsonPath(reader,packageRoot,block.describe);
      const description=await reader.readJson(path,DESCRIPTION_LIMIT);
      rows.push(estimate(name,kind,description,options.count));
    } catch (error) {
      rows.push(unavailable(name,kind,error instanceof FileProblem ? error.issue : 'description_unreadable'));
    }
    // Give the host an opportunity to process I/O between packages.
    await new Promise<void>(done=>setImmediate(done));
  }
  return finish();

  function finish():ScanReport {
    const measuredTokens=rows.reduce((sum,row)=>sum+(row.totalTokens ?? 0),0);
    for(const row of rows) row.share=row.totalTokens !== null && measuredTokens>0 ? row.totalTokens/measuredTokens : null;
    rows.sort((a,b)=>(b.totalTokens ?? -1)-(a.totalTokens ?? -1) || (a.name < b.name ? -1 : a.name>b.name ? 1:0));
    return { profile:options.profile,estimatedAt:new Date().toISOString(),rows,measuredTokens,
      completeCount:rows.filter(r=>r.status==='complete').length,partialCount:rows.filter(r=>r.status==='partial').length,
      unavailableCount:rows.filter(r=>r.status==='unavailable').length,directoryStatus };
  }
}
