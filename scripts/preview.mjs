// Public synthetic fixtures only. Uses the real World data plane, SDK context, Node worker and HTTP binary protocol.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import ExcelJS from 'exceljs';
import {demoReport} from '../tests/helpers/runtime-report.ts';
import {fixture} from '../tests/helpers/fixture.ts';
import {emptyRuntime} from '../src/runtime/types.ts';
import {ContextMeterWorld} from '../src/world.ts';
import {isBinaryResult} from 'cortico/web/shared/webui-protocol.ts';
const root=resolve(import.meta.dirname,'..'),output=join(root,'.preview');await mkdir(output,{recursive:true});
const f=await fixture();let runtime=demoReport(18);const calls=[];
function refreshSyntheticTotals(){
  runtime.totals.providerRequests=runtime.requests.length;runtime.totals.toolCalls=runtime.tools.length;
  for(const field of ['input','output','cachedInput','uncachedInput','reasoning'])runtime.totals[field]=runtime.requests.reduce((sum,r)=>sum+(r[field]??0),0);
  runtime.groups=[...new Set(runtime.tools.map(t=>t.owner))].map(owner=>{const tools=runtime.tools.filter(t=>t.owner===owner);return {
    owner,calls:tools.length,perMinute:tools.length/(runtime.durationMs/60000),durationMs:tools.reduce((n,t)=>n+(t.durationMs??0),0),failures:0,
    textTokens:tools.reduce((n,t)=>n+(t.textTokens??0),0),measuredTexts:tools.length,unknownTexts:0,imageCount:tools.reduce((n,t)=>n+(t.imageCount??0),0)};});
}
for(const [name,count] of [['cortico-world-forest',25],['cortico-world-terrarium',14],['cortico-world-social',13],['cortico-world-library',34],['cortico-world-messenger',8],['@example/cortico-world-long-package-name',5],['cortico-world-context-meter',0]]){
  await f.add(name,'world',{tools:Array.from({length:count},(_,i)=>({name:'public_tool_'+i,description:'Public synthetic tool declaration.',parameters:{type:'object',properties:{}}})),prompts:count?[{key:'public',content:'Public synthetic template {{value}}.'}]:[]});
}
const observer={status:()=>structuredClone(runtime),start:async profile=>{runtime.state='recording';runtime.profile=profile;runtime.endedAt=null;return structuredClone(runtime);},
  stop:async()=>{runtime.state='stopped';runtime.endedAt??=new Date().toISOString();return structuredClone(runtime);},
  clear:async()=>{runtime=emptyRuntime(runtime.profile);return structuredClone(runtime);}};
const world=new ContextMeterWorld({cfg:{enabled:true,profile:'v41'},directory:f.directory,dataDir:f.base,persist(){},observer});
await world.start(new Proxy({},{get(){throw new Error('No host model, event or log access permitted');}}));
const invoke=world.webUi().invoke;await invoke('overview','scan',[]);await invoke('runtime','stop',[]);
const seedId=(await invoke('runtime','history.list',[])).entries[0].id;
const csp="script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const bootstrap=`
import extension from '/webui.js';
import {createPanelContext} from 'cortico/web/client/webui-pages/context.ts';
import {Lifecycle} from 'cortico/web/client/core/lifecycle.ts';
const params=new URLSearchParams(location.search),panel=params.get('panel')||'runtime';
if(params.has('view'))localStorage.setItem('context-meter.runtimeView',JSON.stringify(params.get('view')));
if(params.has('resetSort'))localStorage.removeItem('context-meter.runtimeSort');
window.__browserWorkerAttempts=0;window.__cspViolations=[];
window.Worker=class{constructor(){window.__browserWorkerAttempts++;throw new Error('Browser workers forbidden in desktop regression test');}};
document.addEventListener('securitypolicyviolation',event=>window.__cspViolations.push(event.effectiveDirective));
const lifecycle=new Lifecycle(()=>{}),ticks=[];
const memo={get:(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},set:(key,value)=>localStorage.setItem(key,JSON.stringify(value))};
const ctx=createPanelContext({pageId:'world:context-meter',panelId:panel,root:document.querySelector('#panel'),lifecycle,overlayHost:document.querySelector('#overlays'),refresh:async()=>{},addLeaveGuard:()=>({dispose(){}}),memo,
  createSocket:()=>{throw new Error('No socket needed by this panel');},wsUrl:path=>path,onError:()=>{},mountSlot:async()=>({dispose(){}})});
window.__pendingPanelRequests=0;
for(const method of ['invoke','invokeBinary']){const original=ctx[method];ctx[method]=async(...args)=>{window.__pendingPanelRequests++;try{return await original.apply(ctx,args);}finally{window.__pendingPanelRequests--;}};}
const interval=ctx.interval;ctx.interval=(fn,ms)=>{ticks.push(fn);return interval(fn,ms);};
window.addEventListener('pagehide',()=>lifecycle.dispose(),{once:true});
window.demo={tick:()=>ticks.forEach(fn=>fn()),addRow:async()=>{const response=await fetch('/preview/add-row',{method:'POST'});if(!response.ok)throw new Error('Synthetic update failed');},unmount:()=>lifecycle.dispose()};
try{await extension.panels[panel].mount(ctx);await document.fonts.ready;document.documentElement.dataset.ready='true';}catch{document.documentElement.dataset.error='Synthetic panel mount failed';}
`;
const built=await build({stdin:{contents:bootstrap,resolveDir:root,loader:'ts',sourcefile:'console-bootstrap.ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,external:['/webui.js']});
const bootstrapJs=built.outputFiles[0].text;
const html=lang=>`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/webui.css"><title>Token count synthetic regression</title><style>body{margin:0;padding:24px;background:#e9ece7;font-family:system-ui,"Microsoft YaHei UI",sans-serif}main{max-width:1440px;margin:auto;min-width:0}h1{font-size:20px;font-weight:600;color:#2D4639;margin:0 0 18px}h1 small{font-size:12px;font-weight:400;color:#4C6D5E}@media(max-width:600px){body{padding:12px}}</style><script type="module" src="/console-bootstrap.js"></script></head><body><main><h1>token计数 <small>· 合成数据预览 / Synthetic data</small></h1><div id="panel"></div></main><div id="overlays"></div></body></html>`;
const served=[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');served.push(url.pathname);
  try{
    if(url.pathname==='/'||url.pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp});res.end(html(url.searchParams.get('lang')==='en'?'en':'zh'));return;}
    if(url.pathname==='/console-bootstrap.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bootstrapJs);return;}
    if(['/webui.js','/webui.css'].includes(url.pathname)){
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript'});res.end(await readFile(join(root,'dist',url.pathname.slice(1))));return;
    }
    if(url.pathname==='/preview/add-row'&&req.method==='POST'){
      const request=structuredClone(runtime.requests.at(-1)),tool=structuredClone(runtime.tools.at(-1));
      request.id='feedface0000000000000001';request.responseId='demo-new-response';request.at=new Date(Date.parse(request.at)+10000).toISOString();
      tool.id='demo-new-tool';tool.responseId=request.responseId;tool.at=request.at;request.tools=[tool.id];runtime.requests.push(request);runtime.tools.push(tool);runtime.durationMs+=1000;
      refreshSyntheticTotals();
      res.writeHead(204);res.end();return;
    }
    if(url.pathname==='/preview/pie-fixture'&&req.method==='POST'){
      runtime=demoReport(15);
      for(let i=0;i<runtime.tools.length;i++){runtime.tools[i].tool='synthetic_long_tool_name_for_ring_chart_'+i;runtime.tools[i].owner='synthetic-world-'+i;}
      refreshSyntheticTotals();
      res.writeHead(204);res.end();return;
    }
    const route=url.pathname.match(/^\/api\/webui\/providers\/world%3Acontext-meter\/panels\/(overview|runtime)\/([^/]+)$/i);
    if(route&&req.method==='POST'){
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('Oversized synthetic request');chunks.push(chunk);}
      const {args}=JSON.parse(Buffer.concat(chunks).toString('utf8')),method=decodeURIComponent(route[2]);calls.push(method);
      const value=await invoke(route[1],method,args);
      if(isBinaryResult(value)){res.writeHead(200,{'Content-Type':value.$binary.mime});res.end(Buffer.from(value.$binary.base64,'base64'));}
      else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value??null));}return;
    }
    res.writeHead(404);res.end();
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:/^E_(EXPORT|XLSX)_[A-Z]+$/.test(error.message)?error.message:'E_EXPORT_DATA'}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browserPath='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser=spawn(browserPath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
  '--disable-extensions','--metrics-recording-only','--noerrdialogs','--remote-debugging-port=0',`--user-data-dir=${join(output,'browser-profile')}`,
  '--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=localhost;127.0.0.1','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',ws;
browser.stderr.on('data',chunk=>{stderr+=chunk;});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await delay(50);}throw new Error('Preview wait timed out.');}
const checks={};
try{
  await until(()=>/DevTools listening on (ws:\/\/[^\s]+)/.test(stderr));
  const endpoint=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1];
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map(),listeners=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(String(event.data));
    if(message.id){const call=pending.get(message.id);if(call){pending.delete(message.id);message.error?call.reject(new Error(JSON.stringify(message.error))):call.resolve(message.result);}}
    else for(const listener of listeners)listener(message);
  });
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  const target=await send('Target.createTarget',{url:'about:blank'}),attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const call=(method,params={})=>send(method,params,attached.sessionId);
  const external=[];
  listeners.push(message=>{if(message.method==='Fetch.requestPaused'){
    const {request,requestId}=message.params;
    if(request.url.startsWith(origin+'/')||request.url.startsWith('blob:'+origin+'/')||request.url==='about:blank')void call('Fetch.continueRequest',{requestId});
    else{external.push(request.url);void call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
  }});
  await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  async function navigate(query,width=1440,height=1100){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:origin+'/index.html?'+query});
    await until(()=>evaluate("document.documentElement.dataset.ready==='true'"));
    assert.equal(await evaluate('document.documentElement.dataset.error||null'),null);
    await evaluate('document.fonts.ready');
  }
  async function screenshot(name,clip){
    if(!clip){const metrics=await call('Page.getLayoutMetrics');clip={x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1};}
    const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});await writeFile(join(output,name),Buffer.from(result.data,'base64'));
  }
  async function copyChecks(runtimePage){
    const result=await evaluate(`(()=>{const intro=document.querySelector('.cm-copy-intro'),note=document.querySelector('.cm-copy-notes'),notice=document.querySelector('.cm-export-note');
      const style=e=>{const s=getComputedStyle(e);return {size:s.fontSize,italic:s.fontStyle,weight:s.fontWeight,color:s.color,lineHeight:s.lineHeight};};
      return {intro:style(intro.querySelector('p,li')),emphasis:[...intro.querySelectorAll('strong')].map(e=>({text:e.textContent,...style(e)})),
        note:style(note.querySelector('p,li')),introBullets:intro.querySelectorAll('li').length,noteBullets:note.querySelectorAll('li').length,
        marker:note.querySelector('li')?getComputedStyle(note.querySelector('li'),'::marker').content:null,
        exportHidden:notice.hidden,exportHeight:notice.getBoundingClientRect().height,exportText:notice.textContent,
        status:document.querySelector('.cm-status').textContent,dataStyle:style(document.querySelector('.cm-stat strong')),
        bodyFits:document.documentElement.scrollWidth<=innerWidth};})()`);
    assert.equal(result.intro.size,'13px');assert.equal(result.intro.italic,'italic');assert.equal(result.emphasis.length,2);
    for(const e of result.emphasis){assert.equal(e.size,'14px');assert.equal(e.italic,'italic');assert.equal(e.weight,'700');}
    assert.equal(result.note.size,'11px');assert.equal(result.note.italic,'italic');assert.equal(result.note.color,'rgb(138, 148, 140)');assert.equal(result.note.lineHeight,'17.6px');
    assert.equal(result.introBullets,runtimePage?2:0);assert.equal(result.noteBullets,runtimePage?6:0);if(runtimePage)assert(result.marker.includes('•'));
    assert(result.exportHidden);assert.equal(result.exportHeight,0);assert.equal(result.exportText,'');assert.equal(result.dataStyle.italic,'normal');assert(result.bodyFits);
    return result;
  }
  await navigate('panel=runtime&view=simple&resetSort=1&resetHistory=1');
  checks.copy={runtimeZh:await copyChecks(true)};
  const downloadPath=join(output,'downloads');await mkdir(downloadPath,{recursive:true});
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath,eventsEnabled:true});
  let download=null,downloaded=false;
  listeners.push(message=>{
    if(message.method==='Browser.downloadWillBegin')download=message.params;
    if(message.method==='Browser.downloadProgress'&&message.params.state==='completed')downloaded=true;
  });
  await evaluate(`document.querySelector('[data-action=export]').click()`);
  await until(()=>downloaded);
  const saved=JSON.parse(await readFile(join(downloadPath,download.suggestedFilename),'utf8'));
  assert.equal(saved.extension.displayName,'token计数');assert.equal(saved.extension.version,'0.5.2');
  assert.equal(saved.static.rows.length,7);assert.equal(saved.runtime.requests.length,18);assert.equal(saved.runtime.tools.length,19);
  assert.equal(saved.runtime.requests[0].totalTokens,runtime.requests[0].input+runtime.requests[0].output);
  assert.equal(await evaluate(`document.querySelector('.cm-export-note').textContent`),'已生成导出文件。');
  checks.export={file:download.suggestedFilename,requests:saved.runtime.requests.length,tools:saved.runtime.tools.length,staticRows:saved.static.rows.length};
  downloaded=false;download=null;
  await evaluate(`document.querySelector('[data-export-format]').value='xlsx';document.querySelector('[data-action=export]').click()`);
  await until(async()=>downloaded||await evaluate(`!!document.querySelector('.cm-export-note').dataset.errorCode`),15000);
  assert(downloaded,'Excel download failed under Cortico declared-asset-only serving.');
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(await readFile(join(downloadPath,download.suggestedFilename)));
  assert.equal(excel.worksheets.length,6);assert.equal(excel.getWorksheet('模型请求').rowCount,19);assert.equal(excel.getWorksheet('工具明细').rowCount,20);
  checks.excel={file:download.suggestedFilename,sheets:excel.worksheets.map(s=>s.name),requests:18,tools:19};
  assert(!served.includes('/xlsx-worker.js'),'Excel must not request an undeclared sibling asset.');
  checks.excel.declaredAssetsOnly=true;
  checks.excel.browserWorkerAttempts=await evaluate('window.__browserWorkerAttempts');assert.equal(checks.excel.browserWorkerAttempts,0);
  checks.excel.csp=csp;assert.deepEqual(await evaluate('window.__cspViolations'),[]);
  assert(calls.includes('export.xlsx'));assert.equal(await evaluate(`document.querySelector('.cm-export-note').dataset.version`),'0.5.2');
  assert.equal(await evaluate('document.querySelectorAll("details[open]").length'),0);
  checks.simple=await evaluate(`({columns:document.querySelectorAll('.cm-merged-table>thead>tr>th').length,requestRows:document.querySelectorAll('tr[data-kind=request]').length,
    total:document.querySelector('tr[data-kind=request] [data-column=total]').textContent,bodyFits:document.documentElement.scrollWidth<=innerWidth})`);
  assert.equal(checks.simple.columns,9);assert.equal(checks.simple.requestRows,18);assert(checks.simple.bodyFits);
  const last=runtime.requests.at(-1);assert.equal(checks.simple.total,(last.input+last.output).toLocaleString('zh-CN'));
  await screenshot('runtime-simple.png');
  await evaluate(`document.querySelector('[data-view=detailed]').click()`);
  checks.detailed=await evaluate(`({columns:document.querySelectorAll('.cm-merged-table>thead>tr>th').length,total:document.querySelector('tr[data-kind=request] [data-column=total]').textContent})`);
  assert.equal(checks.detailed.columns,21);assert.equal(checks.detailed.total,checks.simple.total);
  await screenshot('runtime-detailed.png');
  await evaluate(`{const f=document.querySelector('.cm-merged-scroll');f.scrollLeft=1000;f.scrollTop=150;}`);
  checks.frozen=await evaluate(`(()=>{const f=document.querySelector('.cm-merged-scroll'),r=f.getBoundingClientRect(),tool=document.querySelector('.cm-merged-table>tbody .cm-tool-frozen'),head=document.querySelector('.cm-merged-table>thead .cm-tool-frozen');return {frameLeft:r.left,toolLeft:tool.getBoundingClientRect().left,headLeft:head.getBoundingClientRect().left,frameTop:r.top,headTop:head.getBoundingClientRect().top,scrollLeft:f.scrollLeft,position:getComputedStyle(tool).position,background:getComputedStyle(tool).backgroundColor}})()`);
  assert.equal(checks.frozen.position,'sticky');assert(Math.abs(checks.frozen.toolLeft-checks.frozen.frameLeft)<=2);assert(Math.abs(checks.frozen.headLeft-checks.frozen.frameLeft)<=2);
  assert(Math.abs(checks.frozen.headTop-checks.frozen.frameTop)<=2);assert.notEqual(checks.frozen.background,'rgba(0, 0, 0, 0)');
  const clip=await evaluate(`(()=>{const r=document.querySelector('.cm-merged-scroll').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`);
  await screenshot('frozen-tool.png',clip);
  await evaluate(`document.querySelector('[data-expand]').click();document.querySelector('.cm-controls button').click()`);
  await until(()=>evaluate(`document.querySelector('.cm-status').dataset.state==='recording'`));
  const anchorExpression=`(()=>{const f=document.querySelector('.cm-merged-scroll'),top=f.getBoundingClientRect().top+f.querySelector('thead').getBoundingClientRect().height;
    const row=[...document.querySelectorAll('.cm-merged-table>tbody>tr[data-row-key]')].find(r=>r.getBoundingClientRect().bottom>top);return {key:row.dataset.rowKey,offset:row.getBoundingClientRect().top-f.getBoundingClientRect().top,left:f.scrollLeft,expanded:document.querySelectorAll('.cm-detail-row').length}})()`;
  const before=await evaluate(anchorExpression);await evaluate('(async()=>{await window.demo.addRow();window.demo.tick();})()');
  await until(()=>evaluate(`document.querySelectorAll('tr[data-kind=request]').length===19`));
  const after=await evaluate(anchorExpression);assert.equal(after.key,before.key);assert(Math.abs(after.offset-before.offset)<=2);assert.equal(after.left,before.left);assert.equal(after.expanded,1);
  checks.liveUpdate={before,after};
  checks.multipleTools=await evaluate(`({rows:document.querySelectorAll('.cm-detail-row table tbody tr').length,requestTotals:document.querySelectorAll('.cm-detail-row [data-column=total]').length,innerHeading:getComputedStyle(document.querySelector('.cm-detail-panel th:not(.cm-tool-frozen)')).position})`);
  assert.equal(checks.multipleTools.rows,2);assert.equal(checks.multipleTools.requestTotals,0);assert.equal(checks.multipleTools.innerHeading,'static');
  await evaluate(`{const f=document.querySelector('.cm-merged-scroll'),row=document.querySelector('[data-expand]').closest('tr');f.scrollLeft=0;f.scrollTop+=row.getBoundingClientRect().top-f.getBoundingClientRect().top-60;}`);
  const multipleClip=await evaluate(`(()=>{const r=document.querySelector('.cm-merged-scroll').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`);
  await screenshot('multiple-tools.png',multipleClip);
  await evaluate(`document.querySelector('[data-view=pie]').click()`);
  checks.pie=await evaluate(`({total:Number(document.querySelector('.cm-pie').dataset.total),slices:document.querySelectorAll('.cm-pie-svg path').length,
    sortHidden:document.querySelector('.cm-sort').hidden,historyVisible:!document.querySelector('.cm-history').hidden,bodyFits:document.documentElement.scrollWidth<=innerWidth})`);
  assert.equal(checks.pie.total,runtime.requests.reduce((sum,q)=>sum+q.input+q.output,0));assert.equal(checks.pie.slices,8);assert(checks.pie.sortHidden&&checks.pie.historyVisible&&checks.pie.bodyFits);
  await evaluate(`document.querySelector('.cm-pie-item').focus();window.demo.tick()`);
  await until(()=>evaluate(`document.activeElement.matches('.cm-pie-item.cm-pie-active')`));
  assert.equal(await evaluate(`document.querySelectorAll('.cm-pie-svg path.cm-pie-active').length`),1);
  await evaluate(`{const path=document.querySelector('.cm-pie-svg path');path.focus();path.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}`);
  checks.pie.keyboard=await evaluate(`document.activeElement.matches('.cm-pie-svg path.cm-pie-active')`);assert(checks.pie.keyboard);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelectorAll('.cm-pie-active').length`),0);
  await screenshot('runtime-pie.png');
  await evaluate(`document.querySelector('[data-view=detailed]').click()`);assert.equal(await evaluate(`document.querySelectorAll('.cm-detail-row').length`),1);
  await evaluate(`document.querySelector('.cm-sort').open=true;const c=document.querySelector('[data-sort=column]');c.value='input';const d=document.querySelector('[data-sort=direction]');d.value='asc';d.dispatchEvent(new Event('change'))`);
  checks.sorting=await evaluate(`({first:document.querySelector('tr[data-kind=request] [data-column=input]').textContent,open:document.querySelector('.cm-sort').open})`);
  assert.equal(checks.sorting.first,'96,000');await screenshot('sorting.png');
  await evaluate(`document.querySelector('.cm-sort').open=false`);
  await until(()=>evaluate(`(()=>{const button=document.querySelectorAll('.cm-controls button')[1];if(button.disabled)return false;button.click();return true;})()`));
  await until(()=>evaluate(`document.querySelector('.cm-status').dataset.state==='stopped'`));
  await evaluate(`document.querySelectorAll('.cm-controls button')[2].click();document.querySelector('.cm-history').open=true`);
  await until(()=>evaluate(`!!document.querySelector('[data-history-view]')&&window.__pendingPanelRequests===0&&document.querySelector('.cm-status').dataset.state==='off'`));
  await evaluate(`document.querySelector('[data-history-view="${seedId}"]').click()`);await until(()=>evaluate(`!document.querySelector('.cm-history-banner').hidden`));
  assert.equal(await evaluate(`document.querySelectorAll('tr[data-kind=request]').length`),18);
  await evaluate(`document.querySelector('[data-view=pie]').click()`);
  checks.pie.historyTotal=await evaluate(`Number(document.querySelector('.cm-pie').dataset.total)`);
  assert.equal(checks.pie.historyTotal,saved.runtime.requests.reduce((sum,q)=>sum+q.input+q.output,0));
  await evaluate(`{const row=document.querySelector('[data-history-view="${seedId}"]').closest('.cm-history-row');[...row.querySelectorAll('button')].find(b=>b.textContent==='重命名').click();row.querySelector('.cm-history-edit input').value='网页测试 · 上午';[...row.querySelectorAll('button')].find(b=>b.textContent==='保存名称').click();}`);
  await until(()=>evaluate(`document.querySelector('.cm-history-banner').textContent.includes('网页测试 · 上午')`));await screenshot('history.png');
  await navigate('panel=runtime&view=simple');await evaluate(`document.querySelector('.cm-history').open=true`);
  await until(()=>evaluate(`document.querySelector('.cm-history').textContent.includes('网页测试 · 上午')`));
  checks.history={afterClearRequests:18,renamed:'网页测试 · 上午',reloadRetained:true};
  await navigate('panel=overview');checks.static=await evaluate(`({rows:document.querySelectorAll('tbody>tr').length,bodyFits:document.documentElement.scrollWidth<=innerWidth})`);
  checks.copy.staticZh=await copyChecks(false);
  assert.equal(checks.static.rows,7);assert(checks.static.bodyFits);await screenshot('static.png');
  await navigate('panel=runtime&view=simple&lang=en',390,844);checks.narrow=await evaluate(`({bodyFits:document.documentElement.scrollWidth<=innerWidth,frameWidth:document.querySelector('.cm-merged-scroll').clientWidth,tableWidth:document.querySelector('.cm-merged-table').scrollWidth,columns:document.querySelectorAll('.cm-merged-table>thead>tr>th').length})`);
  checks.copy.runtimeEnNarrow=await copyChecks(true);assert.equal(checks.copy.runtimeEnNarrow.status,'Off · Reference: V4.1');
  assert(checks.narrow.bodyFits);assert(checks.narrow.tableWidth>checks.narrow.frameWidth);assert.equal(checks.narrow.columns,9);await screenshot('narrow.png');
  await evaluate(`fetch('/preview/pie-fixture',{method:'POST'})`);
  await navigate('panel=runtime&view=pie&lang=zh',1440,1100);
  await evaluate(`document.querySelector('.cm-pie-other').open=true`);
  checks.pie.other=await evaluate(`({slices:document.querySelectorAll('.cm-pie-svg path').length,members:document.querySelectorAll('.cm-pie-member').length,
    open:document.querySelector('.cm-pie-other').open,total:Number(document.querySelector('.cm-pie').dataset.total),bodyFits:document.documentElement.scrollWidth<=innerWidth})`);
  assert.equal(checks.pie.other.slices,10);assert.equal(checks.pie.other.members,6);assert(checks.pie.other.open&&checks.pie.other.bodyFits);
  assert.equal(checks.pie.other.total,runtime.requests.reduce((sum,q)=>sum+q.input+q.output,0));await screenshot('pie-other.png');
  await navigate('panel=runtime&lang=en',390,844);
  checks.pie.narrow=await evaluate(`({remembered:document.querySelector('[data-view=pie]').getAttribute('aria-pressed'),bodyFits:document.documentElement.scrollWidth<=innerWidth,
    legendTop:document.querySelector('.cm-pie-legend').getBoundingClientRect().top,ringTop:document.querySelector('.cm-pie-svg').getBoundingClientRect().top,
    english:document.querySelector('.cm-pie').textContent.includes('Counted total tokens')})`);
  assert.equal(checks.pie.narrow.remembered,'true');assert(checks.pie.narrow.bodyFits&&checks.pie.narrow.english);assert(checks.pie.narrow.ringTop>checks.pie.narrow.legendTop);
  await screenshot('pie-narrow.png');assert.deepEqual(await evaluate('window.__cspViolations'),[]);
  await navigate('panel=overview&lang=en',390,844);checks.copy.staticEnNarrow=await copyChecks(false);await screenshot('static-narrow-en.png');
  checks.externalPageRequests=external;assert.deepEqual(external,[]);checks.servedRoutes=[...new Set(served)];checks.browser=(await send('Browser.getVersion')).product;
  checks.realWorldBinaryApi=true;checks.calls=[...new Set(calls)];
  await writeFile(join(output,'browser-checks.json'),JSON.stringify(checks,null,2)+'\n');
  console.log(JSON.stringify({checks:'passed',screenshots:['static.png','runtime-simple.png','runtime-detailed.png','frozen-tool.png','multiple-tools.png','narrow.png','history.png','sorting.png','runtime-pie.png','pie-other.png','pie-narrow.png','static-narrow-en.png'].map(n=>join(output,n)),report:join(output,'browser-checks.json')}));
  await send('Browser.close');
}finally{
  ws?.close();browser.kill();await world.stop();await new Promise(resolve=>server.close(resolve));await f.cleanup();
}
