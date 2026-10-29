import {afterEach,describe,it,expect,vi} from 'vitest';
import {Worker} from 'node:worker_threads';
import {RuntimeObserver} from '../src/runtime/controller.ts';
import type {RuntimeReport} from '../src/runtime/types.ts';
import {runtimeFixture,tool,result,usage} from './helpers/runtime-fixture.ts';
const fixtureList:Awaited<ReturnType<typeof runtimeFixture>>[]=[];
const workers:Worker[]=[];const observers:RuntimeObserver[]=[];
const guard=new URL('./helpers/runtime-guard.mjs',import.meta.url);
const bundle=new URL('../dist/observer-worker.mjs',import.meta.url);
afterEach(async()=>{
  for(const o of observers)await o.stop();observers.length=0;
  for(const w of workers)await w.terminate();workers.length=0;
  for(const f of fixtureList)await f.cleanup();fixtureList.length=0;
});
async function setup(){const f=await runtimeFixture();fixtureList.push(f);return f;}
describe('actual offline worker and controller lifecycle',()=>{
  it('runs real tokenizers under network/subprocess/file guards and emits counts only',async()=>{
    const f=await setup();const messages:Record<string,any>[]=[];let printed='';
    const w=new Worker(bundle,{workerData:{dataDir:f.dataDir,profile:'v41',pid:process.pid},execArgv:['--import',guard.href],stdout:true,stderr:true});workers.push(w);
    w.on('message',m=>messages.push(m));w.stdout?.on('data',c=>{printed+=c;});w.stderr?.on('data',c=>{printed+=c;});
    w.on('error',()=>{ /* Startup failure is asserted through the missing report, without an uncaught exception. */ });
    await vi.waitFor(()=>expect(messages.some(m=>m.type==='report'&&m.report.state==='recording')).toBe(true),{timeout:8000});
    expect(messages.some(m=>m.test==='guard-ready')).toBe(true);
    const now=Date.now();const at=new Date(now+10).toISOString();
    await f.append('tools',tool('new',{ts:at,durMs:1}));await f.append('transcript',result('new','PRIVATE_NEW_TOOL_RESULT',{ts:at}));
    await f.append('usage',usage('new',{ts:at,attempt:{...usage().attempt,id:'new',startedAt:new Date(now).toISOString(),elapsedMs:10}}));
    await vi.waitFor(()=>expect(messages.some(m=>m.type==='report'&&m.report.tools.length===1)).toBe(true),{timeout:8000});
    const report=messages.filter(m=>m.type==='report').at(-1)!.report as RuntimeReport;
    expect(report.tools[0].textTokens).toBeGreaterThan(0);expect(report.totals.input).toBe(100);
    expect(JSON.stringify(messages.filter(m=>m.type==='report'))).not.toContain('PRIVATE_');expect(printed).toBe('');
    expect(messages.filter(m=>m.test==='forbidden')).toEqual([]);
    w.postMessage({type:'stop'});await vi.waitFor(()=>expect(messages.some(m=>m.type==='report'&&m.report.state==='stopped')).toBe(true),{timeout:8000});
    const count=messages.filter(m=>m.test==='read').length;
    await f.append('tools',tool('after',{ts:new Date().toISOString()}));
    // An exited worker cannot perform subsequent reads; termination also waits for OS handles.
    await w.terminate();expect(messages.filter(m=>m.test==='read')).toHaveLength(count);
  });
  it('stays off without a worker, serializes controls, retains stopped reports and clears in memory',async()=>{
    const f=await setup();const observer=new RuntimeObserver({dataDir:f.dataDir,execArgv:['--import',guard.href]});observers.push(observer);
    expect(observer.status().state).toBe('off');expect((await observer.stop()).state).toBe('off');
    const a=await observer.start('v41');expect(a.state).toBe('recording');
    const same=await observer.start('v41');expect(same.startedAt).toBe(a.startedAt);
    await expect(observer.start('v4')).rejects.toThrow('Stop observation');await expect(observer.clear()).rejects.toThrow('Stop observation');
    expect((await observer.stop()).state).toBe('stopped');expect(observer.status().startedAt).toBe(a.startedAt);
    expect((await observer.clear()).state).toBe('off');
    expect((await observer.start('v4')).profile).toBe('v4');await observer.stop();
  });
  it('hides worker startup error details and can recover with another start',async()=>{
    const f=await setup();const observer=new RuntimeObserver({dataDir:f.dataDir,workerUrl:new URL('./PRIVATE_NONEXISTENT_WORKER.mjs',import.meta.url)});observers.push(observer);
    await expect(observer.start('v41')).rejects.toThrow('Observer unavailable');
    expect(observer.status().state).toBe('error');expect(JSON.stringify(observer.status())).not.toContain('PRIVATE_');
    await observer.clear();expect(observer.status().state).toBe('off');
  });
});
