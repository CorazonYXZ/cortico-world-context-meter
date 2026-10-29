import {afterEach,describe,it,expect,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import {mountRuntime} from '../src/webui/runtime.ts';
import {emptyRuntime,type RuntimeReport} from '../src/runtime/types.ts';
import {request,tool,demoReport} from './helpers/runtime-report.ts';
import {createExport} from '../src/export.ts';
import type {StoredHistory} from '../src/history.ts';
const windows:JSDOM[]=[];afterEach(()=>{for(const d of windows)d.window.close();windows.length=0;});
function setup(language='zh',initial=emptyRuntime(),preferences=new Map<string,unknown>(),histories:StoredHistory[]=[]){
  const dom=new JSDOM('<main></main>');windows.push(dom);
  const document=dom.window.document,abort=new dom.window.AbortController(),root=document.querySelector('main')!;
  let report=structuredClone(initial);const ticks:(()=>void)[]=[];
  const invoke=vi.fn(async(method:string,args:unknown[]=[])=>{
    if(method==='history.list')return {entries:histories.map(r=>r.entry),warnings:0,saveFailed:false};
    if(method==='history.get')return histories.find(r=>r.entry.id===args[0]);
    if(method==='history.rename'){const record=histories.find(r=>r.entry.id===args[0])!;record.entry.name=args[1] as string;return record.entry;}
    if(method==='history.delete'){histories.splice(histories.findIndex(r=>r.entry.id===args[0]),1);return null;}
    if(method==='start')report={...report,state:'recording',profile:args[0] as 'v41'|'v4'};
    if(method==='stop')report={...report,state:'stopped'};
    if(method==='clear')report=emptyRuntime(report.profile);
    return report;
  });
  const h=(tag:string,cls?:string|null,text?:string|null)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined&&text!==null)e.textContent=text;return e;};
  const ctx={root,language,signal:abort.signal,invoke,memo:{get:(key:string,fallback:unknown)=>preferences.get(key)??fallback,set:(key:string,value:unknown)=>preferences.set(key,value)},interval:(fn:()=>void)=>{ticks.push(fn);return {dispose(){}};},ui:{h,
    button:(text:string,opts:{onClick:()=>void})=>{const button=h('button',null,text);button.addEventListener('click',opts.onClick,{signal:abort.signal});return button;},
  }} as unknown as WebUiPanelContext;
  return {dom,abort,root,ctx,invoke,preferences,setReport:(next:RuntimeReport)=>{report=structuredClone(next);},tick:()=>ticks.forEach(fn=>fn())};
}
describe('opt-in bilingual observation panel',()=>{
  it('starts off, never starts on mount and does not poll when off',async()=>{
    const c=setup();await mountRuntime(c.ctx);expect(c.invoke).toHaveBeenCalledTimes(1);expect(c.invoke).toHaveBeenCalledWith('status',[]);
    c.tick();expect(c.invoke).toHaveBeenCalledTimes(1);
    expect([...c.root.querySelectorAll('.cm-intro li')].map(e=>e.textContent)).toEqual([
      '开启本功能后，新增运行记录仅在本机内存处理；处理时可能临时接触聊天和敏感工具结果，但正文、参数、文件路径、网页地址均不展示、不留存、不上传。',
      '请求总用量以宿主供应商记账值为准；工具文本仅为新增内容估算，不能与请求总用量相加，也不代表实际费用占比。']);
    expect([...c.root.querySelectorAll('.cm-intro strong')].map(e=>e.textContent)).toEqual(['仅在本机内存处理','不展示、不留存、不上传']);
    expect(c.root.querySelector('.cm-status')?.textContent).toBe('未开启 · 参考: V4.1');
    expect(c.root.querySelector<HTMLElement>('.cm-export-note')?.hidden).toBe(true);
    expect(c.root.textContent).toContain('V4-Flash-Vision-Exp');
  });
  it('supports explicit start, stop and clear and only polls in-memory status while recording',async()=>{
    const c=setup('en');await mountRuntime(c.ctx);
    const select=c.root.querySelector('select')!;select.value='v4';c.root.querySelectorAll('button')[0].click();
    await vi.waitFor(()=>expect(c.invoke).toHaveBeenLastCalledWith('start',['v4']));
    c.tick();await vi.waitFor(()=>expect(c.invoke).toHaveBeenCalledTimes(3));
    c.root.querySelectorAll('button')[1].click();await vi.waitFor(()=>expect(c.invoke).toHaveBeenLastCalledWith('stop',[]));
    const n=c.invoke.mock.calls.length;c.tick();expect(c.invoke).toHaveBeenCalledTimes(n);
    c.root.querySelectorAll('button')[2].click();await vi.waitFor(()=>expect(c.invoke).toHaveBeenLastCalledWith('clear',[]));
    expect(c.root.textContent).toContain('Off');
  });
  it('leaves capture running on unmount while preventing further panel requests',async()=>{
    const report=emptyRuntime();report.state='recording';const c=setup('zh',report);await mountRuntime(c.ctx);
    c.abort.abort();c.tick();c.root.querySelectorAll('button')[1].click();expect(c.invoke).toHaveBeenCalledTimes(1);
    expect(c.invoke.mock.calls.some(([method])=>method==='stop')).toBe(false);
  });
  it('shows missing values, conditional image bounds and source coverage without HTML execution',async()=>{
    const report:RuntimeReport=emptyRuntime();report.state='stopped';report.issues.unmatched_result=1;
    report.tools=[{id:'tool',run:'run',round:1,responseId:null,callId:'call',at:new Date().toISOString(),startedAt:null,
      tool:'<img src=x onerror=alert(1)>',owner:'example',role:'main',durationMs:null,failed:null,boundary:true,textTokens:null,
      textBasis:null,imageCount:2,imageTokens:null,flashImageUpperBound:2048}];
    const c=setup('zh',report);await mountRuntime(c.ctx);
    c.root.querySelector<HTMLButtonElement>('[data-view="detailed"]')!.click();
    expect(c.root.textContent).toContain('2,048');expect(c.root.textContent).toContain('图片实际 token 未知');expect(c.root.textContent).toContain('部分工具结果未能配对');
    expect(c.root.querySelector('img')).toBeNull();expect(c.root.textContent).toContain('—');
  });
  it('defaults to exactly nine simple columns, shows the total once, and freezes the tool column in both modes',async()=>{
    const report=emptyRuntime();report.requests=[request('one',['a'])];report.tools=[tool('a','one')];
    const c=setup('zh',report);await mountRuntime(c.ctx);
    const table=c.root.querySelector('.cm-merged-table')!;
    expect(table.querySelectorAll(':scope > thead > tr > th')).toHaveLength(9);
    expect(table.querySelector('[data-column="total"]')?.textContent).toContain('输入＋输出');
    expect(table.querySelector('tbody [data-column="total"]')?.textContent).toBe('120');
    expect(table.querySelector('tbody .cm-tool-frozen')?.textContent).toContain('socialmedia_search');
    c.root.querySelector<HTMLButtonElement>('[data-view="detailed"]')!.click();
    expect(table.querySelectorAll(':scope > thead > tr > th')).toHaveLength(21);
    expect(table.querySelector('tbody [data-column="total"]')?.textContent).toBe('120');
    expect(table.querySelector('tbody .cm-tool-frozen')).not.toBeNull();
  });
  it('expands individual tools without repeating request tokens and preserves view, focus, expansion and scrolling on refresh',async()=>{
    const report=demoReport(3);report.state='recording';const c=setup('en',report);await mountRuntime(c.ctx);
    c.root.querySelector<HTMLButtonElement>('[data-view="detailed"]')!.click();
    const expand=c.root.querySelector<HTMLButtonElement>('[data-expand]')!;expand.focus();expand.click();
    expect(c.root.querySelectorAll('.cm-detail-row table tbody tr')).toHaveLength(2);
    expect(c.root.querySelectorAll('.cm-detail-row [data-column="total"]')).toHaveLength(0);
    const frame=c.root.querySelector<HTMLElement>('.cm-merged-scroll')!;frame.scrollLeft=450;frame.scrollTop=40;
    const next=structuredClone(report);next.durationMs+=1000;c.setReport(next);c.tick();
    await vi.waitFor(()=>expect(c.invoke).toHaveBeenCalledTimes(2));
    expect(c.root.querySelector('.cm-merged-scroll')).toBe(frame);expect(frame.scrollLeft).toBe(450);expect(frame.scrollTop).toBe(40);
    expect(c.root.querySelectorAll('.cm-detail-row table tbody tr')).toHaveLength(2);
    expect(c.dom.window.document.activeElement?.getAttribute('aria-expanded')).toBe('true');
    c.root.querySelector<HTMLButtonElement>('[data-view="simple"]')!.click();expect(frame.scrollLeft).toBe(0);
  });
  it('remembers only the display preference across mounts and leaves all explanatory text visible',async()=>{
    const preferences=new Map<string,unknown>();const c=setup('zh',emptyRuntime(),preferences);await mountRuntime(c.ctx);
    c.root.querySelector<HTMLButtonElement>('[data-view="detailed"]')!.click();
    expect([...preferences.values()]).toEqual(['detailed']);
    const next=setup('zh',emptyRuntime(),preferences);await mountRuntime(next.ctx);
    expect(next.root.querySelector('[data-view="detailed"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(next.root.querySelectorAll('.cm-disclosure')).toHaveLength(2);expect(next.root.querySelectorAll('details[open]')).toHaveLength(0);
    expect(next.root.querySelectorAll('.cm-notes li')).toHaveLength(6);
    expect(next.invoke).toHaveBeenCalledTimes(1);
  });
  it('renders at most 200 top-level rows after joining all records and leaves unknown totals blank',async()=>{
    const report=demoReport(205);report.requests[204].input=null;const c=setup('en',report);await mountRuntime(c.ctx);
    const rows=c.root.querySelectorAll('.cm-merged-table > tbody > tr[data-row-key]');expect(rows).toHaveLength(200);
    expect(rows[0].querySelector('[data-column="total"]')?.textContent).toBe('—');
    expect(c.root.textContent).toContain('200 / 205');expect(c.root.querySelectorAll('tr[data-kind="unlinked"]')).toHaveLength(0);
  });
  it('keeps both controls collapsed, sorts all rows before limiting, and remembers the condition across modes',async()=>{
    const c=setup('en',demoReport(205));await mountRuntime(c.ctx);
    expect(c.root.querySelectorAll('details[open]')).toHaveLength(0);
    const column=c.root.querySelector<HTMLSelectElement>('[data-sort=column]')!,direction=c.root.querySelector<HTMLSelectElement>('[data-sort=direction]')!;
    column.value='input';direction.value='asc';direction.dispatchEvent(new c.dom.window.Event('change'));
    expect(c.root.querySelector('tbody [data-column=input]')?.textContent).toBe('96,000');
    c.root.querySelector<HTMLButtonElement>('[data-view=detailed]')!.click();expect(column.value).toBe('input');
    expect(c.preferences.get('context-meter.runtimeSort')).toEqual({column:'input',direction:'asc'});
    column.value='duration';column.dispatchEvent(new c.dom.window.Event('change'));c.root.querySelector<HTMLButtonElement>('[data-view=simple]')!.click();
    expect(column.value).toBe('duration');expect(column.selectedOptions[0].textContent).toContain('detailed column');
  });
  it('views history across the whole dashboard without stopping live polling, supports rename and returns to current',async()=>{
    const old=demoReport(1),payload=createExport(null,old);
    const record:StoredHistory={entry:{id:'saved',name:'旧观察',renamed:false,startedAt:old.startedAt!,endedAt:old.endedAt,checkpointAt:old.updatedAt!,retentionAt:old.endedAt!,
      status:'stopped',requests:1,totalTokens:old.totals.input!+old.totals.output!,incomplete:false,bytes:100},payload};
    const live=demoReport(3);live.state='recording';const c=setup('zh',live,new Map(),[record]);await mountRuntime(c.ctx);
    const box=c.root.querySelector<HTMLDetailsElement>('.cm-history')!;box.open=true;box.dispatchEvent(new c.dom.window.Event('toggle'));
    await vi.waitFor(()=>expect(c.root.querySelector('[data-history-view=saved]')).not.toBeNull());
    c.root.querySelector<HTMLButtonElement>('[data-history-view=saved]')!.click();
    await vi.waitFor(()=>expect(c.root.textContent).toContain('正在查看历史: 旧观察'));
    expect(c.root.querySelectorAll('tr[data-kind=request]')).toHaveLength(1);
    const updated=demoReport(4);updated.state='recording';c.setReport(updated);c.tick();
    await vi.waitFor(()=>expect(c.invoke).toHaveBeenLastCalledWith('status',[]));expect(c.root.querySelectorAll('tr[data-kind=request]')).toHaveLength(1);
    const rename=[...c.root.querySelectorAll('button')].find(b=>b.textContent==='重命名')!;rename.click();
    const input=c.root.querySelector<HTMLInputElement>('.cm-history-edit input')!;input.value='我的测试';
    [...c.root.querySelectorAll('button')].find(b=>b.textContent==='保存名称')!.click();
    await vi.waitFor(()=>expect(c.root.textContent).toContain('正在查看历史: 我的测试'));
    c.root.querySelector<HTMLButtonElement>('.cm-history-banner button')!.click();expect(c.root.querySelectorAll('tr[data-kind=request]')).toHaveLength(4);
    expect(c.invoke.mock.calls.some(([m])=>m==='stop')).toBe(false);
  });
  it('remembers the pie view, hides only table sorting, and retains table sorting and tool expansion when returning',async()=>{
    const c=setup('zh',demoReport(3));await mountRuntime(c.ctx);
    c.root.querySelector<HTMLButtonElement>('[data-view=detailed]')!.click();c.root.querySelector<HTMLButtonElement>('[data-expand]')!.click();
    const column=c.root.querySelector<HTMLSelectElement>('[data-sort=column]')!;column.value='input';column.dispatchEvent(new c.dom.window.Event('change'));
    c.root.querySelector<HTMLButtonElement>('[data-view=pie]')!.click();
    expect(c.root.querySelector<HTMLElement>('.cm-pie')!.hidden).toBe(false);expect(c.root.querySelector<HTMLElement>('.cm-sort')!.hidden).toBe(true);
    expect(c.root.querySelector<HTMLElement>('.cm-merged-scroll')!.hidden).toBe(true);expect(c.root.querySelector<HTMLElement>('.cm-history')!.hidden).toBe(false);
    expect(c.root.querySelectorAll('.cm-pie-svg path')).toHaveLength(3);expect(c.root.textContent).toContain('多工具共享');
    expect(c.preferences.get('context-meter.runtimeView')).toBe('pie');
    c.root.querySelector<HTMLButtonElement>('[data-view=detailed]')!.click();expect(column.value).toBe('input');expect(c.root.querySelectorAll('.cm-detail-row')).toHaveLength(1);
    expect(c.root.querySelector<HTMLElement>('.cm-sort')!.hidden).toBe(false);
    c.preferences.set('context-meter.runtimeView','pie');const next=setup('en',demoReport(1),c.preferences);await mountRuntime(next.ctx);
    expect(next.root.querySelector('[data-view=pie]')?.getAttribute('aria-pressed')).toBe('true');expect(next.root.querySelector('.cm-pie')?.textContent).toContain('Counted total tokens');
  });
  it('preserves keyboard highlight, category colors and Other expansion on refresh; safely renders long names',async()=>{
    const report=demoReport(12);report.state='recording';
    for(let i=0;i<report.tools.length;i++){report.tools[i].tool='kind_'+i;report.tools[i].owner='world_'+i;}
    report.tools[0].tool='<img src=x onerror=alert(1)>_very_long_public_synthetic_name';
    const c=setup('zh',report);await mountRuntime(c.ctx);c.root.querySelector<HTMLButtonElement>('[data-view=pie]')!.click();
    const box=c.root.querySelector<HTMLDetailsElement>('.cm-pie-other')!;expect(box.hidden).toBe(false);box.open=true;
    const members=c.root.querySelector<HTMLElement>('.cm-pie-members')!;members.scrollTop=40;
    const legend=c.root.querySelector<HTMLButtonElement>('.cm-pie-item')!,key=legend.dataset.pieKey,color=legend.querySelector<HTMLElement>('.cm-pie-swatch')!.style.backgroundColor;
    legend.focus();expect(legend.classList.contains('cm-pie-active')).toBe(true);expect(c.root.querySelector('path.cm-pie-active')?.getAttribute('data-pie-key')).toBe(key);
    const next=structuredClone(report);next.requests[11].input=next.requests[10].input!-1;c.setReport(next);c.tick();
    await vi.waitFor(()=>expect(c.invoke).toHaveBeenCalledTimes(2));
    const active=c.dom.window.document.activeElement as HTMLElement;expect(active.dataset.pieKey).toBe(key);expect(active.classList.contains('cm-pie-active')).toBe(true);
    expect(active.querySelector<HTMLElement>('.cm-pie-swatch')!.style.backgroundColor).toBe(color);expect(box.open).toBe(true);expect(members.scrollTop).toBe(40);
    active.dispatchEvent(new c.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(c.root.querySelectorAll('.cm-pie-active')).toHaveLength(0);
    expect(c.root.querySelector('img')).toBeNull();expect(c.root.querySelector('.cm-pie-other')?.textContent).toContain('<img src=x');
  });
  it('keeps a historical pie isolated from live updates, and displays unknown and zero without drawing slices',async()=>{
    const old=demoReport(1),payload=createExport(null,old),record:StoredHistory={entry:{id:'saved',name:'图表历史',renamed:false,startedAt:old.startedAt!,endedAt:old.endedAt,
      checkpointAt:old.updatedAt!,retentionAt:old.endedAt!,status:'stopped',requests:1,totalTokens:96023,incomplete:false,bytes:100},payload};
    const live=demoReport(3);live.state='recording';const c=setup('zh',live,new Map(),[record]);await mountRuntime(c.ctx);c.root.querySelector<HTMLButtonElement>('[data-view=pie]')!.click();
    const box=c.root.querySelector<HTMLDetailsElement>('.cm-history')!;box.open=true;box.dispatchEvent(new c.dom.window.Event('toggle'));
    await vi.waitFor(()=>expect(c.root.querySelector('[data-history-view=saved]')).not.toBeNull());c.root.querySelector<HTMLButtonElement>('[data-history-view=saved]')!.click();
    await vi.waitFor(()=>expect(c.root.querySelector('.cm-pie')?.getAttribute('data-total')).toBe('96023'));
    c.setReport(demoReport(5));c.tick();await vi.waitFor(()=>expect(c.invoke).toHaveBeenLastCalledWith('status',[]));expect(c.root.querySelector('.cm-pie')?.getAttribute('data-total')).toBe('96023');
    c.root.querySelector<HTMLButtonElement>('.cm-history-banner button')!.click();expect(c.root.querySelector('.cm-pie')?.getAttribute('data-total')).not.toBe('96023');
    const unknown=demoReport(1);unknown.requests[0].input=null;const u=setup('en',unknown);await mountRuntime(u.ctx);u.root.querySelector<HTMLButtonElement>('[data-view=pie]')!.click();
    expect(u.root.querySelector('.cm-pie')?.getAttribute('data-state')).toBe('unknown');expect(u.root.querySelectorAll('.cm-pie-svg path')).toHaveLength(0);
    unknown.requests[0].input=0;unknown.requests[0].output=0;const z=setup('zh',unknown);await mountRuntime(z.ctx);z.root.querySelector<HTMLButtonElement>('[data-view=pie]')!.click();
    expect(z.root.querySelector('.cm-pie')?.getAttribute('data-state')).toBe('zero');expect(z.root.querySelectorAll('.cm-pie-svg path')).toHaveLength(0);expect(z.root.textContent).toContain('不绘制扇区');
  });
});
