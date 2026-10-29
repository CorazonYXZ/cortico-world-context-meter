import {afterEach,describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import {mount} from '../src/webui/client.ts';
import type {ScanReport} from '../src/types.ts';
const windows:JSDOM[]=[];
afterEach(()=>{for(const dom of windows)dom.window.close();windows.length=0;});
const report:ScanReport={profile:'v41',estimatedAt:'2026-01-01T00:00:00.000Z',measuredTokens:42,completeCount:1,partialCount:0,unavailableCount:1,directoryStatus:'ok',rows:[
  {name:'cortico-world-example',kind:'world',toolCount:1,toolTokens:40,promptTokens:2,totalTokens:42,share:1,status:'complete',issues:[]},
  {name:'<img src=x onerror=alert(1)>',kind:'unknown',toolCount:null,toolTokens:null,promptTokens:null,totalTokens:null,share:null,status:'unavailable',issues:['missing_description']},
]};
function context(language='zh',invoke=vi.fn(async()=>report)) {
  const dom=new JSDOM('<main id="root"></main>');windows.push(dom);
  const document=dom.window.document,abort=new dom.window.AbortController();
  const h=(tag:string,cls?:string|null,text?:string|null)=>{
    const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined && text!==null)element.textContent=text;return element;
  };
  const ui={h,button:(text:string,opts:{onClick:()=>void})=>{
    const button=h('button',null,text);button.addEventListener('click',opts.onClick,{signal:abort.signal});return button;
  }};
  const root=document.querySelector<HTMLElement>('#root')!;
  const ctx={root,signal:abort.signal,language,invoke,ui} as unknown as WebUiPanelContext;
  return {dom,root,abort,invoke,ctx};
}
describe('local bilingual panel',()=>{
  it('loads once, displays uncertainty and renders package names as text',async()=>{
    const c=context();await mount(c.ctx);
    expect(c.invoke).toHaveBeenCalledTimes(1);expect(c.invoke).toHaveBeenCalledWith('scan',[]);
    expect(c.root.querySelector('.cm-intro')?.textContent).toBe('声明：本页仅为静态估算，不是实际请求、账单或节省金额。统计只比较已安装包（含未启用包）自带的工具声明与原始提示词模板，不判断当前实际发送了哪些内容；不读取聊天、记忆、工具回执或密钥。需要动态观察请移步“运行观察”页。');
    expect([...c.root.querySelectorAll('.cm-intro strong')].map(e=>e.textContent)).toEqual(['声明','静态估算，不是实际请求、账单或节省金额']);
    expect(c.root.querySelector<HTMLElement>('.cm-export-note')?.hidden).toBe(true);
    expect(c.root.textContent).toContain('V4-Flash-Vision-Exp');
    expect(c.root.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(c.root.querySelector('img')).toBeNull();
    expect(c.root.querySelectorAll('tbody tr')[1].textContent).toContain('无法评估');
    expect(c.root.querySelectorAll('tbody tr')[1].textContent).toContain('—');
  });
  it('applies a tokenizer only after manual refresh and has no background requests',async()=>{
    const invoke=vi.fn(async(_method?:string,args?:unknown[])=>({...report,profile:args?.[0]==='v4'?'v4' as const:'v41' as const}));
    const c=context('en',invoke);await mount(c.ctx);
    const select=c.root.querySelector('select')!;select.value='v4';select.dispatchEvent(new c.dom.window.Event('change'));
    expect(invoke).toHaveBeenCalledTimes(1);expect(c.root.textContent).toContain('Click Refresh');
    c.root.querySelector('button')!.click();
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith('scan',['v4']);expect(c.root.textContent).toContain('DeepSeek-V4-Pro');
    c.abort.abort();c.root.querySelector('button')!.click();expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('does not render a result after unmount and keeps errors private',async()=>{
    let resolve!:(report:ScanReport)=>void;
    const c=context('zh',vi.fn(()=>new Promise<ScanReport>(done=>{resolve=done;})));
    const mounting=mount(c.ctx);c.abort.abort();resolve(report);await mounting;
    expect(c.root.querySelector('table')).toBeNull();
    const failed=context('en',vi.fn(async()=>{throw new Error('PRIVATE_SENTINEL');}));await mount(failed.ctx);
    expect(failed.root.textContent).toContain('Scan failed');expect(failed.root.textContent).not.toContain('PRIVATE_SENTINEL');
  });
});
