import {describe,it,expect,vi} from 'vitest';
import type {WorldHost} from 'cortico/core/types.ts';
import {ContextMeterWorld} from '../src/world.ts';
import {emptyRuntime} from '../src/runtime/types.ts';
import type {Observer} from '../src/runtime/controller.ts';
describe('runtime panel controls',()=>{
  function setup(){
    const report=emptyRuntime();
    const observer:Observer={status:vi.fn(()=>structuredClone(report)),start:vi.fn(async profile=>({...report,state:'recording' as const,profile})),
      stop:vi.fn(async()=>({...report,state:'stopped' as const})),clear:vi.fn(async()=>report)};
    const persist=vi.fn();const world=new ContextMeterWorld({cfg:{enabled:false,profile:'v41'},directory:'none',observer,persist});
    return {world,observer,persist,invoke:world.webUi().invoke!};
  }
  it('does not capture on mount/status; requires activation and closes capture on world stop',async()=>{
    const {world,observer,invoke,persist}=setup();await invoke('runtime','status',[]);
    expect(observer.start).not.toHaveBeenCalled();await expect(invoke('runtime','start',[])).rejects.toThrow('启用');
    await world.start(new Proxy({},{get(){throw new Error('No host calls permitted');}}) as WorldHost);
    expect(observer.start).not.toHaveBeenCalled();await invoke('runtime','start',['v4']);
    expect(observer.start).toHaveBeenCalledWith('v4');expect(persist).toHaveBeenCalledWith('v4');
    await world.stop();expect(observer.stop).toHaveBeenCalledTimes(1);
    expect(world.envPromptVars()).toBeNull();expect(world.tools()).toEqual([]);
    await expect(invoke('runtime','start',[])).rejects.toThrow('启用');
  });
  it('rejects arbitrary methods, parameters and paths without touching the observer',async()=>{
    const {world,observer,invoke}=setup();await world.start({} as WorldHost);
    await expect(invoke('runtime','start',['../private'])).rejects.toThrow();
    await expect(invoke('runtime','readFile',['private.md'])).rejects.toThrow();
    await expect(invoke('runtime','status',['private.md'])).rejects.toThrow();
    expect(observer.start).not.toHaveBeenCalled();expect(observer.status).not.toHaveBeenCalled();
  });
  it('exports an in-memory snapshot from either panel without starting capture, scanning or persisting',async()=>{
    const {world,observer,invoke,persist}=setup();
    expect(world.webUi().label).toBe('token计数');expect(world.webUi('en').label).toBe('Token count');
    for(const panel of ['overview','runtime']){
      const data=await invoke(panel,'export',[]) as {static:unknown;runtime:{state:string}};
      expect(data.static).toBeNull();expect(data.runtime.state).toBe('off');
    }
    const recording={...emptyRuntime(),state:'recording' as const};
    vi.mocked(observer.status).mockReturnValue(recording);
    const snapshot=await invoke('runtime','export',[]) as {runtime:{state:string}};
    expect(snapshot.runtime.state).toBe('recording');expect(recording.state).toBe('recording');
    expect(observer.start).not.toHaveBeenCalled();expect(observer.stop).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
    await expect(invoke('runtime','export',['private.md'])).rejects.toThrow();
    await expect(invoke('other','export',[])).rejects.toThrow();
  });
});
