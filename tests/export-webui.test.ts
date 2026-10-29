import {afterEach,describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import {exportControls} from '../src/webui/export.ts';
import {createExport} from '../src/export.ts';
import {XLSX_MIME,OWNER_ID} from '../src/excel-protocol.ts';
import {demoReport} from './helpers/runtime-report.ts';
const windows:JSDOM[]=[];afterEach(()=>{for(const dom of windows)dom.window.close();windows.length=0;});
function setup(language='zh',selection:string|null=null){
  const dom=new JSDOM('<main></main>');windows.push(dom);const {document}=dom.window;
  const abort=new dom.window.AbortController(),root=document.querySelector('main')!;
  const invoke=vi.fn(async()=>createExport(null,demoReport(205)));
  const invokeBinary=vi.fn(async(_method:string,_args:unknown[])=>new Blob([new Uint8Array([80,75,3,4,0,0])],{type:XLSX_MIME}));
  const resources:{dispose():void}[]=[],timers:(()=>void)[]=[],unmountCalls:unknown[][]=[];
  const create=vi.fn((_blob:Blob)=>'blob:local-statistics'),revoke=vi.fn(),click=vi.spyOn(dom.window.HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  Object.assign(dom.window.URL,{createObjectURL:create,revokeObjectURL:revoke});
  const browserWorker=vi.fn(()=>{throw new Error('Browser workers forbidden');});Object.defineProperty(dom.window,'Worker',{value:browserWorker});
  const notify=vi.fn((method:string,args:unknown[])=>{abort.signal.addEventListener('abort',()=>unmountCalls.push([method,args]),{once:true});});
  const h=(tag:string,cls?:string|null,text?:string)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const ctx={root,language,signal:abort.signal,invoke,invokeBinary,notifyOnUnmount:notify,own:(resource:{dispose():void})=>{resources.push(resource);return resource;},
    timeout:(fn:()=>void)=>{timers.push(fn);return {dispose(){}};},ui:{h,button:(text:string,opts:{onClick:()=>void})=>{
      const button=document.createElement('button');button.textContent=text;button.addEventListener('click',opts.onClick,{signal:abort.signal});return button;
    }}} as unknown as WebUiPanelContext;
  const control=exportControls(ctx,()=>selection);root.append(control.format,control.button,control.notice);
  return {dom,abort,root,ctx,invoke,invokeBinary,notify,unmountCalls,browserWorker,create,revoke,click,resources,timers,...control};
}
describe('manual JSON and binary Excel download',()=>{
  it('keeps JSON compatible, exports full metadata once and cleans up the download URL',async()=>{
    const c=setup();expect(c.invoke).not.toHaveBeenCalled();expect(c.notice.hidden).toBe(true);expect(c.notice.textContent).toBe('');
    c.button.click();c.button.click();expect(c.notice.hidden).toBe(false);expect(c.notice.textContent).toBe('正在取得统计…');
    await vi.waitFor(()=>expect(c.click).toHaveBeenCalledTimes(1));expect(c.invoke).toHaveBeenCalledWith('export',[]);
    expect(c.invokeBinary).not.toHaveBeenCalled();expect(c.notify).not.toHaveBeenCalled();expect(c.browserWorker).not.toHaveBeenCalled();
    const anchor=c.click.mock.contexts[0] as unknown as HTMLAnchorElement;expect(anchor.download).toMatch(/^token-count-.*\.json$/);
    const blob=c.create.mock.calls[0][0];
    const text=await new Promise<string>((resolve,reject)=>{const reader=new c.dom.window.FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob);});
    expect(JSON.parse(text).runtime.requests).toHaveLength(205);c.timers[0]();c.resources[0].dispose();expect(c.revoke).toHaveBeenCalledTimes(1);
    expect(c.button.disabled).toBe(false);expect(c.notice.textContent).toBe('已生成导出文件。');
  });
  it('uses invokeBinary and the selected id, registers owned cancellation once and never constructs a browser worker',async()=>{
    const c=setup('zh','saved-id');c.root.querySelector('select')!.value='xlsx';c.button.click();expect(c.notice.textContent).toBe('正在本机生成 Excel…');
    await vi.waitFor(()=>expect(c.click).toHaveBeenCalledTimes(1));const owner=c.invokeBinary.mock.calls[0][1]?.[2];
    expect(typeof owner).toBe('string');expect(OWNER_ID.test(String(owner))).toBe(true);
    expect(c.invokeBinary).toHaveBeenCalledWith('export.xlsx',['saved-id','zh',owner]);expect(c.notify).toHaveBeenCalledWith('export.cancel',[owner]);
    expect(c.invoke).not.toHaveBeenCalled();expect(c.browserWorker).not.toHaveBeenCalled();
    expect((c.click.mock.contexts[0] as unknown as HTMLAnchorElement).download).toMatch(/\.xlsx$/);expect(c.create.mock.calls[0][0].type).toBe(XLSX_MIME);
    c.button.click();await vi.waitFor(()=>expect(c.click).toHaveBeenCalledTimes(2));expect(c.notify).toHaveBeenCalledTimes(1);
  });
  it('shows only fixed versioned error codes and permits retry without exposing error bodies or paths',async()=>{
    const c=setup('en');c.root.querySelector('select')!.value='xlsx';
    c.invokeBinary.mockRejectedValueOnce(new Error('PRIVATE_PATH E_XLSX_TIMEOUT PRIVATE_BODY'));
    c.button.click();await vi.waitFor(()=>expect(c.notice.dataset.errorCode).toBe('E_XLSX_TIMEOUT'));
    expect(c.root.textContent).toContain('v0.5.1');expect(c.root.textContent).not.toContain('PRIVATE_');expect(c.button.disabled).toBe(false);
    c.button.click();await vi.waitFor(()=>expect(c.click).toHaveBeenCalledTimes(1));expect(c.notice.dataset.errorCode).toBeUndefined();
  });
  it('classifies generic transport failure and invalid binary bodies without exposing their contents',async()=>{
    const c=setup('en');c.root.querySelector('select')!.value='xlsx';c.invokeBinary.mockRejectedValueOnce(new Error('PRIVATE_TRANSPORT'));
    c.button.click();await vi.waitFor(()=>expect(c.notice.dataset.errorCode).toBe('E_EXPORT_TRANSPORT'));
    c.invokeBinary.mockResolvedValueOnce(new Blob(['PRIVATE_ERROR'],{type:'application/json'}));c.button.click();
    await vi.waitFor(()=>expect(c.invokeBinary).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(c.button.disabled).toBe(false));
    expect(c.notice.dataset.errorCode).toBe('E_EXPORT_TRANSPORT');expect(c.root.textContent).not.toContain('PRIVATE_');expect(c.create).not.toHaveBeenCalled();
  });
  it('does not download a late binary result after unmount and sends cancellation only for its own owner',async()=>{
    const c=setup();let done!:(blob:Blob)=>void;c.invokeBinary.mockImplementationOnce(()=>new Promise<Blob>(resolve=>{done=resolve;}));
    c.root.querySelector('select')!.value='xlsx';c.button.click();await vi.waitFor(()=>expect(c.notify).toHaveBeenCalledTimes(1));c.abort.abort();
    done(new Blob([new Uint8Array([80,75,3,4])],{type:XLSX_MIME}));await Promise.resolve();await Promise.resolve();
    expect(c.unmountCalls).toEqual([['export.cancel',c.notify.mock.calls[0][1]]]);expect(c.create).not.toHaveBeenCalled();expect(c.click).not.toHaveBeenCalled();
  });
  it('reports download preparation separately and never shows the underlying exception',async()=>{
    const c=setup();c.create.mockImplementationOnce(()=>{throw new Error('PRIVATE_DOWNLOAD');});c.button.click();
    await vi.waitFor(()=>expect(c.notice.dataset.errorCode).toBe('E_EXPORT_DOWNLOAD'));expect(c.root.textContent).not.toContain('PRIVATE_DOWNLOAD');
  });
  it('keeps data errors private and avoids any further requests or draws after abort',async()=>{
    const c=setup('en');c.invoke.mockRejectedValueOnce(new Error('PRIVATE_DATA'));c.button.click();
    await vi.waitFor(()=>expect(c.notice.dataset.errorCode).toBe('E_EXPORT_DATA'));expect(c.root.textContent).not.toContain('PRIVATE_DATA');
    c.abort.abort();c.button.click();expect(c.invoke).toHaveBeenCalledTimes(1);
  });
});
