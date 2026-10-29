import {afterEach,describe,it,expect} from 'vitest';
import {readFile,writeFile,symlink,mkdir,link} from 'node:fs/promises';
import {join} from 'node:path';
import {HistoryStore} from '../src/history.ts';
import {createExport} from '../src/export.ts';
import {demoReport} from './helpers/runtime-report.ts';
import {fixture} from './helpers/fixture.ts';
const fixtures:Awaited<ReturnType<typeof fixture>>[]=[];
afterEach(async()=>{for(const f of fixtures)await f.cleanup();fixtures.length=0;});
async function setup(options:ConstructorParameters<typeof HistoryStore>[1]={}){
  const f=await fixture();fixtures.push(f);let now=Date.parse('2026-10-29T04:13:00Z');
  const audit:{operation:string;file:string}[]=[];
  const store=new HistoryStore(f.base,{now:()=>now,audit:(operation,file)=>audit.push({operation,file}),...options});
  return {f,store,audit,dir:join(f.base,'context-meter','history'),later:(ms:number)=>{now+=ms;},now:()=>now};
}
describe('bounded local history',()=>{
  it('persists complete metadata and survives a new store instance without any original log reads',async()=>{
    const c=await setup(),report=demoReport(205);Object.assign(report.requests[0],{body:'PRIVATE_BODY',arguments:'PRIVATE_ARGS'});
    const entry=await c.store.save(createExport(null,report));
    const fresh=new HistoryStore(c.f.base,{now:c.now}),record=await fresh.get(entry.id);
    expect(record.payload.runtime.requests).toHaveLength(205);expect(record.payload.runtime.tools).toHaveLength(206);
    expect(record.payload.selection.id).toBe(entry.id);expect(record.payload.runtime.requests[0].totalTokens).toBe(report.requests[0].input!+report.requests[0].output!);
    const disk=await readFile(join(c.dir,`${entry.id}.json`),'utf8');expect(disk).not.toContain('PRIVATE_');
    expect(c.audit.every(a=>a.file.startsWith(c.dir))).toBe(true);expect(c.audit.some(a=>/usage|transcript|toolcalls/.test(a.file))).toBe(false);
  });
  it('updates one window, preserves rename, and never uses its name as a filesystem path',async()=>{
    const c=await setup(),payload=createExport(null,demoReport(2)),entry=await c.store.save(payload);
    const original=(await c.store.list()).entries[0].retentionAt;
    await c.store.rename(entry.id,'../重命名 =SUM(A1)');c.later(1000);
    await c.store.save(payload,entry.id);const list=await c.store.list();
    expect(list.entries).toHaveLength(1);expect(list.entries[0].name).toBe('../重命名 =SUM(A1)');expect(list.entries[0].retentionAt).toBe(original);
    await expect(c.store.rename(entry.id,' ')).rejects.toThrow('History');await expect(c.store.rename(entry.id,'中'.repeat(81))).rejects.toThrow('History');
  });
  it('marks recovered active snapshots as interrupted and does not invent a completed end time',async()=>{
    const c=await setup(),report=demoReport(2);report.state='recording';report.endedAt=null;
    const entry=await c.store.save(createExport(null,report));
    expect((await c.store.list(entry.id)).entries[0].status).toBe('recording');
    const fresh=new HistoryStore(c.f.base,{now:c.now}),record=await fresh.get(entry.id);
    expect(record.entry.status).toBe('interrupted');expect(record.entry.incomplete).toBe(true);
    expect(record.payload.runtime.state).toBe('stopped');expect(record.payload.runtime.endedAt).toBeNull();
    expect(record.payload.selection.status).toBe('interrupted');
  });
  it('expires after seven days and rename does not extend retention',async()=>{
    const c=await setup(),entry=await c.store.save(createExport(null,demoReport(1)));
    c.later(86400000);await c.store.rename(entry.id,'old');c.later(7*86400000);
    expect((await c.store.list()).entries).toEqual([]);
    await expect(readFile(join(c.dir,`${entry.id}.json`))).rejects.toThrow();
  });
  it('prunes oldest completed records by count and bytes while keeping the active window',async()=>{
    const c=await setup({maxEntries:2});
    const a=await c.store.save(createExport(null,demoReport(1)));c.later(1);
    const report=demoReport(2);report.endedAt='2026-10-29T04:12:01Z';const b=await c.store.save(createExport(null,report));
    report.endedAt='2026-10-29T04:12:02Z';const d=await c.store.save(createExport(null,report));
    expect((await c.store.list()).entries.map(e=>e.id).sort()).toEqual([b.id,d.id].sort());
    await expect(c.store.get(a.id)).rejects.toThrow();
    const tiny=new HistoryStore(c.f.base,{now:c.now,maxBytes:1});report.state='recording';report.endedAt=null;
    const active=await tiny.save(createExport(null,report));expect((await tiny.list(active.id)).entries.map(e=>e.id)).toEqual([active.id]);
  });
  it('rejects arbitrary identities, active deletion, damaged snapshots and invalid index versions',async()=>{
    const c=await setup(),entry=await c.store.save(createExport(null,demoReport(1)));
    for(const id of ['../secret','index','C:\\private'])await expect(c.store.get(id)).rejects.toThrow();
    await expect(c.store.delete(entry.id,entry.id)).rejects.toThrow();
    await writeFile(join(c.dir,`${entry.id}.json`),'{broken');const list=await c.store.list();expect(list.warnings).toBe(1);expect(list.entries).toEqual([]);
    await c.store.delete(entry.id);await writeFile(join(c.dir,'index.json'),'{"schemaVersion":99,"ids":[]}');await expect(c.store.list()).rejects.toThrow();
  });
  it('rejects linked cache directories and linked registered files without touching their targets',async()=>{
    const c=await setup();await mkdir(join(c.f.base,'outside'));await mkdir(join(c.f.base,'context-meter'));
    await symlink(join(c.f.base,'outside'),c.dir,'junction');await expect(c.store.list()).rejects.toThrow();
    const d=await setup(),entry=await d.store.save(createExport(null,demoReport(1))),target=join(d.f.base,'private.json');
    await writeFile(target,'PRIVATE_TARGET');
    const {unlink}=await import('node:fs/promises');await unlink(join(d.dir,`${entry.id}.json`));await link(target,join(d.dir,`${entry.id}.json`));
    expect((await d.store.list()).warnings).toBe(1);await expect(d.store.delete(entry.id)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('PRIVATE_TARGET');
  });
  it('validates stored fields and rejects unknown schemas or malformed counts before returning data',async()=>{
    const c=await setup(),entry=await c.store.save(createExport(null,demoReport(1))),path=join(c.dir,`${entry.id}.json`);
    const data=JSON.parse(await readFile(path,'utf8'));data.payload.runtime.requests[0].input='PRIVATE_COUNT';await writeFile(path,JSON.stringify(data));
    await expect(c.store.get(entry.id)).rejects.toThrow('History');expect((await c.store.list()).warnings).toBe(1);
  });
});
