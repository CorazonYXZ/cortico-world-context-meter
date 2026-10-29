import {afterEach,describe,it,expect,vi} from 'vitest';
import type {WorldHost} from 'cortico/core/types.ts';
import {ContextMeterWorld} from '../src/world.ts';
import {CONTEXT_METER} from '../src/definition.ts';
import {fixture} from './helpers/fixture.ts';
let fixtures:Awaited<ReturnType<typeof fixture>>[]=[];
afterEach(async()=>{for(const f of fixtures)await f.cleanup();fixtures=[];});
const cfg=()=>({enabled:false,profile:'v41' as const});
const forbidden=()=>{throw new Error('Host model/event/log access forbidden');};
describe('World contract and privacy',()=>{
  it('starts and stops without accessing the host, files, models, events or timers',async()=>{
    const counter=vi.fn(forbidden),persist=vi.fn(forbidden);
    const world=new ContextMeterWorld({cfg:cfg(),directory:'does-not-exist',persist,counter});
    expect(world.envPromptVars()).toBeNull();expect(world.tools()).toEqual([]);
    expect(CONTEXT_METER.describe).toEqual({tools:[],events:[]});
    await world.start(new Proxy({},{get:forbidden}) as WorldHost);
    expect(world.webUi('en').panels?.[0].id).toBe('overview');
    await world.stop();expect(counter).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
  });
  it('scans only on panel invocation and persists only its selected profile',async()=>{
    const f=await fixture();fixtures.push(f);await f.add('test-world','world',{tools:[],prompts:[{key:'public',content:'PUBLIC_TEMPLATE'}]});
    const persist=vi.fn(),counter=vi.fn(async()=>((text:string)=>text.length));
    const world=new ContextMeterWorld({cfg:cfg(),directory:f.directory,persist,counter});
    const invoke=world.webUi().invoke!;
    expect(counter).not.toHaveBeenCalled();
    const log=vi.spyOn(console,'log'),warn=vi.spyOn(console,'warn'),error=vi.spyOn(console,'error');
    const report=await invoke('overview','scan',['v4']);
    expect(counter).toHaveBeenCalledTimes(1);expect(counter).toHaveBeenCalledWith('v4');
    expect(persist).toHaveBeenCalledTimes(1);expect(persist).toHaveBeenCalledWith('v4');
    expect(JSON.stringify(report)).not.toContain('PUBLIC_TEMPLATE');
    const exported=await invoke('overview','export',[]) as {static:unknown};
    expect(exported.static).toEqual(report);expect(counter).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(exported)).not.toContain('PUBLIC_TEMPLATE');
    expect(log).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
    log.mockRestore();warn.mockRestore();error.mockRestore();
  });
  it('rejects unsupported methods, payloads and stopped requests without reading files',async()=>{
    const counter=vi.fn(forbidden);
    const world=new ContextMeterWorld({cfg:cfg(),directory:'does-not-exist',persist:forbidden,counter});
    const invoke=world.webUi().invoke!;
    for(const [panel,method,args] of [['other','scan',[]],['overview','chat',[]],['overview','scan',['v41','extra']],['overview','scan',['../secret']]] as const) {
      await expect(invoke(panel,method,[...args])).rejects.toThrow();
    }
    await world.stop();await expect(invoke('overview','scan',[])).rejects.toThrow('停用');
    expect(counter).not.toHaveBeenCalled();
  });
  it('prevents overlapping scans and hides tokenizer parser details',async()=>{
    const f=await fixture();fixtures.push(f);
    let release!:(count:(s:string)=>number)=>void;
    const world=new ContextMeterWorld({cfg:cfg(),directory:f.directory,persist:forbidden,counter:()=>new Promise(done=>{release=done;})});
    const invoke=world.webUi().invoke!;
    const first=invoke('overview','scan',[]);
    await expect(invoke('overview','scan',[])).rejects.toThrow('正在统计');
    release(s=>s.length);await first;
    const broken=new ContextMeterWorld({cfg:cfg(),directory:f.directory,persist:forbidden,counter:async()=>{throw new Error('PRIVATE_SENTINEL');}});
    await expect(broken.webUi().invoke!('overview','scan',[])).rejects.toThrow('随包分词器不可用');
  });
});
