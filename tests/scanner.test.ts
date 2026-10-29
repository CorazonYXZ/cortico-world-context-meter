import {describe,it,expect,afterEach} from 'vitest';
import {mkdir,writeFile,symlink,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fixture} from './helpers/fixture.ts';
import {scan} from '../src/scanner.ts';
import {declarationReader} from '../src/files.ts';
let fixtures:Awaited<ReturnType<typeof fixture>>[]=[];
async function make(){const f=await fixture();fixtures.push(f);return f;}
afterEach(async()=>{for(const f of fixtures)await f.cleanup();fixtures=[];});
const tool={name:'echo',description:'public tool declaration',parameters:{type:'object'}};
describe('safe package scanning',()=>{
  it('ranks directly installed scoped/unscoped packages and returns no declaration bodies',async()=>{
    const f=await make();await f.add('small');await f.add('@scope/large','world',{tools:[tool],prompts:[{key:'env',content:'PUBLIC_PROMPT_SENTINEL'}]});
    await f.add('missing','world',{},undefined);
    await f.json(join(f.directory,'node_modules/missing/package.json'),{cortico:{kind:'world'}});
    const reads:string[]=[];
    const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length,reader:declarationReader(p=>reads.push(p))});
    expect(report.rows.map(r=>r.name)).toEqual(['@scope/large','small','missing']);
    expect(report.rows[0].share).toBe(1);expect(report.rows[2].totalTokens).toBeNull();
    expect(reads).toHaveLength(6);expect(reads.every(p=>p.endsWith('package.json')||p.endsWith('describe.json'))).toBe(true);
    const serialized=JSON.stringify(report);
    for(const text of ['PUBLIC_PROMPT_SENTINEL','public tool declaration','FAKE_PRIVATE','index.mjs'])expect(serialized).not.toContain(text);
  });
  it('does not recurse into undeclared dependencies or directories',async()=>{
    const f=await make();await f.add('allowed');
    await f.json(join(f.directory,'node_modules/not-installed/package.json'),{cortico:{kind:'world'}});
    const reads:string[]=[];await scan({directory:f.directory,profile:'v4',count:s=>s.length,reader:declarationReader(p=>reads.push(p))});
    expect(reads).toHaveLength(3);expect(reads.join()).not.toContain('not-installed');
  });
  it('supports real pnpm-style and local-directory links',async()=>{
    const f=await make();const original=await f.add('@scope/linked','world',{tools:[tool]});
    const target=join(f.base,'actual-package');await rename(original,target);
    await symlink(target,original,process.platform==='win32'?'junction':'dir');
    const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length});
    expect(report.rows[0].status).toBe('complete');expect(report.rows[0].toolCount).toBe(1);
  });
  it('accepts ordinary ./ declaration paths while rejecting Windows alternate streams',async()=>{
    const f=await make();const root=await f.add('relative','world',{},'./describe.json');
    await f.json(join(root,'describe.json'),{tools:[tool]});
    await f.add('stream','world',{},'describe.json:private.json');
    const reads:string[]=[];const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length,reader:declarationReader(p=>reads.push(p))});
    expect(report.rows.find(r=>r.name==='relative')?.status).toBe('complete');
    expect(report.rows.find(r=>r.name==='stream')?.issues).toContain('unsafe_path');
    expect(reads).toHaveLength(4);
  });
  it('rejects traversal, absolute paths, secret file extensions and malicious package names before reading',async()=>{
    const f=await make();await f.add('traversal','world',{},'../secret.json');
    await f.add('absolute','world',{},resolve(f.base,'secret.json'));await f.add('secret','world',{},'.env');
    f.dependencies['../escape']='link:anywhere';await f.manifest();
    const reads:string[]=[];const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length,reader:declarationReader(p=>reads.push(p))});
    expect(report.rows.every(r=>r.status==='unavailable')).toBe(true);
    expect(reads).toHaveLength(4);expect(reads.every(p=>p.endsWith('package.json'))).toBe(true);
  });
  it('rejects a linked describe file escaping the actual package directory',async()=>{
    const f=await make();const root=await f.add('escape','world',{},'linked/secret.json');
    const outside=join(f.base,'outside');await f.json(join(outside,'secret.json'),{tools:[tool]});
    await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');
    const reads:string[]=[];const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length,reader:declarationReader(p=>reads.push(p))});
    expect(report.rows[0].issues).toContain('unsafe_path');expect(reads).toHaveLength(2);
  });
  it('handles malformed JSON without leaking its content into errors',async()=>{
    const f=await make();const root=await f.add('bad');await writeFile(join(root,'describe.json'),'{"PRIVATE_SENTINEL":');
    const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length});
    expect(report.rows[0].status).toBe('unavailable');expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL');
  });
  it('rejects oversized declarations and keeps the result unknown',async()=>{
    const f=await make();const root=await f.add('large');await writeFile(join(root,'describe.json'),' '.repeat(4*1024*1024+1));
    const report=await scan({directory:f.directory,profile:'v41',count:s=>s.length});
    expect(report.rows[0].issues).toContain('oversized_file');expect(report.rows[0].totalTokens).toBeNull();
  });
  it('distinguishes an empty manifest, a missing directory and unreadable metadata',async()=>{
    const f=await make();expect((await scan({directory:f.directory,profile:'v41',count:s=>s.length})).rows).toEqual([]);
    expect((await scan({directory:join(f.base,'absent'),profile:'v41',count:s=>s.length})).directoryStatus).toBe('missing');
    await writeFile(join(f.directory,'package.json'),'malformed');
    expect((await scan({directory:f.directory,profile:'v41',count:s=>s.length})).directoryStatus).toBe('unreadable');
  });
});
