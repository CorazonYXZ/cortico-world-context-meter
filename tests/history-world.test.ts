import {afterEach,describe,it,expect,vi} from 'vitest';
import type {WorldHost} from 'cortico/core/types.ts';
import {ContextMeterWorld} from '../src/world.ts';
import {HistoryStore} from '../src/history.ts';
import type {Observer} from '../src/runtime/controller.ts';
import {emptyRuntime,type RuntimeReport} from '../src/runtime/types.ts';
import type {HistoryList} from '../src/history-types.ts';
import type {StatisticsExport} from '../src/export.ts';
import {demoReport} from './helpers/runtime-report.ts';
import {fixture} from './helpers/fixture.ts';
const fixtures:Awaited<ReturnType<typeof fixture>>[]=[],worlds:ContextMeterWorld[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const w of worlds)await w.stop();worlds.length=0;for(const f of fixtures)await f.cleanup();fixtures.length=0;});
async function setup(){
  const f=await fixture();fixtures.push(f);let report=emptyRuntime(),serial=0;
  const observer:Observer={status:()=>structuredClone(report),start:async()=>{report=demoReport(2);report.state='recording';report.endedAt=null;
    report.startedAt=new Date(Date.now()+serial++).toISOString();report.updatedAt=report.startedAt;return structuredClone(report);},
    stop:async()=>{if(report.startedAt){report.state='stopped';report.endedAt=new Date().toISOString();}return structuredClone(report);},
    clear:async()=>{report=emptyRuntime();return structuredClone(report);}};
  const world=new ContextMeterWorld({cfg:{enabled:true,profile:'v41'},directory:f.directory,dataDir:f.base,persist:vi.fn(),observer});
  worlds.push(world);await world.start({} as WorldHost);
  const invoke=world.webUi().invoke!;
  return {f,world,invoke,observer,set:(next:RuntimeReport)=>{report=structuredClone(next);},get:()=>report};
}
describe('automatic observation checkpoints',()=>{
  it('archives before clear, preserves exports after a restart, and creates a separate next window',async()=>{
    const c=await setup();await c.invoke('runtime','start',[]);await c.invoke('runtime','stop',[]);
    const before=await c.invoke('runtime','history.list',[]) as HistoryList;expect(before.entries).toHaveLength(1);
    const id=before.entries[0].id;await c.invoke('runtime','clear',[]);
    expect((await c.invoke('runtime','status',[]) as RuntimeReport).state).toBe('off');
    const exported=await c.invoke('runtime','export',[id]) as StatisticsExport;expect(exported.runtime.requests).toHaveLength(2);expect(exported.selection.id).toBe(id);
    await c.world.stop();const fresh=new ContextMeterWorld({cfg:{enabled:false,profile:'v41'},directory:c.f.directory,dataDir:c.f.base,persist:vi.fn()});worlds.push(fresh);
    expect((await fresh.webUi().invoke!('runtime','status',[]) as RuntimeReport).state).toBe('off');
    expect((await fresh.webUi().invoke!('runtime','history.list',[]) as HistoryList).entries).toHaveLength(1);
    await c.world.start({} as WorldHost);await c.invoke('runtime','start',[]);await c.invoke('runtime','stop',[]);
    expect((await c.invoke('runtime','history.list',[]) as HistoryList).entries).toHaveLength(2);
  });
  it('checkpoints every ten seconds and leaves current observation active while reading history',async()=>{
    const c=await setup(),interval=vi.spyOn(globalThis,'setInterval');await c.invoke('runtime','start',[]);
    const call=interval.mock.calls.find(([,ms])=>ms===10000)!;expect(call).toBeTruthy();
    const updated=structuredClone(c.get());updated.totals.output=999;c.set(updated);
    (call[0] as ()=>void)();
    await vi.waitFor(async()=>{
      const list=await c.invoke('runtime','history.list',[]) as HistoryList;
      const data=await c.invoke('runtime','export',[list.entries[0].id]) as StatisticsExport;expect(data.runtime.totals.output).toBe(999);
    });
    expect(c.observer.status().state).toBe('recording');
    const list=await c.invoke('runtime','history.list',[]) as HistoryList;
    await expect(c.invoke('runtime','history.delete',[list.entries[0].id])).rejects.toThrow();
    await c.world.stop();expect((await c.invoke('runtime','history.list',[]) as HistoryList).entries[0].status).toBe('stopped');
  });
  it('keeps memory and prevents clear or replacement if saving fails, then permits retry',async()=>{
    const c=await setup();await c.invoke('runtime','start',[]);await c.invoke('runtime','stop',[]);
    const save=vi.spyOn(HistoryStore.prototype,'save').mockRejectedValue(new Error('PRIVATE_FILE_PATH'));
    await expect(c.invoke('runtime','clear',[])).rejects.toThrow('History could not be saved');
    const old=c.observer.status().startedAt;
    await expect(c.invoke('runtime','start',[])).rejects.toThrow('原结果仍保留');
    expect(c.observer.status().startedAt).toBe(old);expect(c.observer.status().requests).toHaveLength(2);
    expect((await c.invoke('runtime','status',[]) as RuntimeReport).historySaveFailed).toBe(true);
    save.mockRestore();await c.invoke('runtime','clear',[]);expect(c.observer.status().state).toBe('off');
  });
  it('does not recreate explicitly deleted current history on clear or next start',async()=>{
    const c=await setup();await c.invoke('runtime','start',[]);await c.invoke('runtime','stop',[]);
    const list=await c.invoke('runtime','history.list',[]) as HistoryList;await c.invoke('runtime','history.delete',[list.entries[0].id]);
    await c.invoke('runtime','clear',[]);expect((await c.invoke('runtime','history.list',[]) as HistoryList).entries).toHaveLength(0);
    await c.invoke('runtime','start',[]);expect((await c.invoke('runtime','history.list',[]) as HistoryList).entries).toHaveLength(1);
  });
});
