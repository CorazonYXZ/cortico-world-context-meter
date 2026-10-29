import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import type {RuntimeIssue,RuntimeReport,RuntimeState,SourceState} from '../runtime/types.ts';
import type {Profile} from '../types.ts';
import {RuntimeTable} from './runtime-table.ts';
import {exportControls} from './export.ts';
import {HistoryControls} from './history.ts';
const text={
  zh:{title:'运行观察',privacyBefore:'开启本功能后，新增运行记录',privacyMemory:'仅在本机内存处理',
    privacyMiddle:'；处理时可能临时接触聊天和敏感工具结果，但正文、参数、文件路径、网页地址均',privacyPolicy:'不展示、不留存、不上传',privacyAfter:'。',
    boundary:'请求总用量以宿主供应商记账值为准；工具文本仅为新增内容估算，不能与请求总用量相加，也不代表实际费用占比。',
    start:'开始观察',stop:'停止观察',clear:'清空结果',profile:'文本参考分词器',error:'操作失败，当前结果仍保留。请检查扩展是否启用，以及临时记录的保存状态。',
    off:'未开启',starting:'准备观察',recording:'正在观察',stopped:'已停止',failed:'观察异常',
    ready:'可读',missing:'尚未出现／缺失',unreadable:'不可读',changed:'文件曾被替换或截断',unavailable:'不可用',
    source:'数据源',usage:'请求用量',index:'当前运行索引',tools:'工具记录',transcript:'完整结果流水',
    duration:'观察时长（秒）',calls:'窗口内供应商请求',input:'已知输入 token',output:'已知输出 token',cached:'其中缓存输入',uncached:'其中未缓存输入',reasoning:'其中推理输出',
    reports:'扩展自报记录',cross:'跨边界／起点未知的请求',crossTools:'跨边界／起点未知的工具',
    coverage:'覆盖提示',unknown:'未知',none:'尚无记录。',
    groupTitle:'按来源汇总：工具频次与新增文本体积',
    groupHeaders:['World 来源','次数','次／分钟','累计耗时 ms','记录失败','已知文本 token','已计／未知文本','图片附件'],
    note:'离开面板仍继续观察；点击停止或停用扩展才结束。重启默认关闭。统计自动暂存本机 7 天，最多 30 次／64 MiB；清空当前结果仍可回看历史，也可手动导出。',
    limits:'仅观察框架已有记录。后台任务可能只有用量、没有操作明细；工具内部未上报步骤不可见。未记账或停止时仍在执行的调用不保证收齐。',
    image:'图片实际 token 未知；Flash 条件上限 = 新增图片件数 × 1,024，仅假设全部作为图像发送，不证明已发送或覆盖重复携带。Pro 不显示此上限。',
    totals:'汇总只累计起止可确认在窗口内的供应商请求；自报和跨边界记录单列。缺失计数不替换为零，已知部分可能不完整。',
    truncated:'已达到内存记录上限；后续记录不再完整。',reference:'参考',
    referenceNote:'V4.1 使用官方 recipe 家族参考，原对照为 V4-Flash-Vision-Exp；不保证与 Flash 服务端或当前请求模型的分词相同。',
    displayed:'每张表最多展示 200 条；汇总包含全部留存记录。',
  },
  en:{title:'Runtime observation',privacyBefore:'After enabling this feature, newly appended runtime records are processed ',privacyMemory:'only in local memory',
    privacyMiddle:'; processing may temporarily involve chat and sensitive tool results, but bodies, arguments, file paths and page URLs are ',privacyPolicy:'not displayed, retained or uploaded',privacyAfter:'.',
    boundary:'Request totals use host-recorded provider meters. Tool text is newly returned content estimated locally: do not add it to request totals or interpret it as a cost share.',
    start:'Start observation',stop:'Stop observation',clear:'Clear results',profile:'Text reference tokenizer',error:'Operation failed; current results are retained. Check World activation and history storage.',
    off:'Off',starting:'Starting',recording:'Recording',stopped:'Stopped',failed:'Observation error',
    ready:'Readable',missing:'Not yet present / missing',unreadable:'Unreadable',changed:'Previously replaced or truncated',unavailable:'Unavailable',
    source:'Sources',usage:'Request usage',index:'Current run index',tools:'Tool records',transcript:'Full-result transcript',
    duration:'Observed seconds',calls:'Provider requests within window',input:'Known input tokens',output:'Known output tokens',cached:'Cached input subset',uncached:'Uncached input subset',reasoning:'Reasoning output subset',
    reports:'World-reported records',cross:'Cross-boundary / unknown-start requests',crossTools:'Cross-boundary / unknown-start tools',
    coverage:'Coverage notices',unknown:'Unknown',none:'No records yet.',
    groupTitle:'By source: tool frequency and new text size',groupHeaders:['World source','Calls','Per minute','Total ms','Marked failed','Known text tokens','Measured / unknown texts','Image attachments'],
    note:'Leaving this panel keeps observation running. Stop it here or disable the extension. Restart defaults to off. Metadata is cached locally for 7 days, up to 30 sessions / 64 MiB. Clearing current results preserves history; manual export is also available.',
    limits:'Only existing host records are observed. Background requests may have usage without operation details. Unreported internal steps are invisible. Pending or unrecorded calls may be absent at stop.',
    image:'Actual image tokens are unknown. Conditional Flash bound = new image count × 1,024, assuming all were sent as images. It does not prove delivery or include reuse. No such bound is shown for Pro.',
    totals:'Totals include only provider requests with a confirmed start and end within the window. Reports and cross-boundary calls are separate. Missing meters remain unknown; known sums may be partial.',
    truncated:'The in-memory record limit was reached; subsequent coverage is incomplete.',reference:'Reference',
    referenceNote:'V4.1 uses the official recipe family reference originally compared against V4-Flash-Vision-Exp. It may differ from Flash server-side tokenization or the model used in a request.',
    displayed:'Each table displays at most 200 rows; aggregates include all retained records.',
  },
};
const issues:Record<RuntimeIssue,[string,string]>={
  missing_source:['部分数据源尚未出现或缺失','Some sources are missing or not yet present'],unreadable_source:['部分数据源不可读','Some sources cannot be read'],
  unsafe_path:['拒绝了越界或链接路径','An unsafe or linked path was rejected'],source_changed:['文件发生替换或截断，未回读旧内容','A file changed; previous content was not reread'],
  oversized_record:['部分记录超过 16 MiB，未计入','Some records exceeded 16 MiB and were excluded'],invalid_record:['部分记录格式或计数不合格','Some records or meters are invalid'],
  unmatched_result:['部分工具结果未能配对或不完整','Some tool results are unmatched or incomplete'],missing_meter:['部分供应商计数缺失','Some provider meters are missing'],
  conflicting_record:['部分重复标识发生冲突','Some duplicate identities conflict'],retention_limit:['达到内存记录上限','The memory record limit was reached'],
  worker_failed:['本机观察线程异常','The local observation worker failed'],stop_incomplete:['停止时未取得最终完整快照','A complete final snapshot was unavailable at stop'],
};
export async function mountRuntime(ctx:WebUiPanelContext):Promise<void> {
  const zh=ctx.language==='zh'||ctx.language==='zh-Hant',m=text[zh?'zh':'en'],h=ctx.ui.h;
  const root=h('section','context-meter cm-runtime');
  const intro=h('div','cm-intro cm-copy-intro'),introList=h('ul','cm-copy-list'),privacy=h('li');
  privacy.append(m.privacyBefore,h('strong',null,m.privacyMemory),m.privacyMiddle,h('strong',null,m.privacyPolicy),m.privacyAfter);
  introList.append(privacy,h('li',null,m.boundary));intro.append(introList);
  const status=h('p','cm-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const controls=h('div','cm-controls'),label=h('label',null,m.profile),select=h('select','field');
  select.setAttribute('aria-label',m.profile);
  for(const profile of ['v41','v4'] as const){const option=h('option',null,profile==='v41'?'DeepSeek-V4.1-Flash / V4.1 reference':'DeepSeek-V4-Pro / V4 reference');option.value=profile;select.append(option);}
  label.append(select);
  const start=ctx.ui.button(m.start,{onClick:()=>{void action('start',[select.value as Profile]);}});
  start.classList.add('cm-primary');
  const stop=ctx.ui.button(m.stop,{onClick:()=>{void action('stop');}});
  const clear=ctx.ui.button(m.clear,{onClick:()=>{void action('clear');}});
  const exporter=exportControls(ctx,()=>history.selected?.entry.id??null);
  controls.append(label,start,stop,clear,exporter.format,exporter.button);
  const stats=h('div'),groups=h('div'),error=h('p','cm-warning');error.setAttribute('role','alert');
  const merged=new RuntimeTable(ctx),notes=h('div','cm-notes cm-copy-notes'),noteList=h('ul','cm-copy-list');
  const historyBanner=h('div','cm-history-banner');historyBanner.hidden=true;
  let live:RuntimeReport|null=null;
  const history=new HistoryControls(ctx,()=>{if(live)render(live);});merged.interactions.prepend(history.root);
  for(const note of [m.note,m.totals,m.image,m.referenceNote,m.limits,m.displayed])noteList.append(h('li',null,note));
  notes.append(noteList);
  root.append(h('h2',null,m.title),intro,controls,exporter.notice,status,historyBanner,error,stats,groups,merged.root,notes);
  ctx.root.append(root);
  let busy=false,recording=false;
  const number=(v:number|null)=>v===null?'—':v.toLocaleString(zh?'zh-CN':'en-US',{maximumFractionDigits:1});
  const stateText:Record<RuntimeState,string>={off:m.off,starting:m.starting,recording:m.recording,stopped:m.stopped,error:m.failed};
  const sourceText:Record<SourceState,string>={ready:m.ready,missing:m.missing,unreadable:m.unreadable,changed:m.changed,unavailable:m.unavailable};
  function table(title:string,headers:string[],rows:string[][]){
    groups.append(h('h3',null,title));if(!rows.length){groups.append(h('p','cm-muted',m.none));return;}
    const wrap=h('div','cm-table-wrap'),table=h('table','cm-table'),head=h('thead'),tr=h('tr'),body=h('tbody');
    for(const [index,title] of headers.entries()){const th=h('th',index?'cm-number':null,title);th.scope='col';tr.append(th);}head.append(tr);
    for(const cells of rows.slice(0,200)){const row=h('tr');for(const [index,value] of cells.entries())row.append(h('td',index?'cm-number':null,value));body.append(row);}
    table.append(head,body);wrap.append(table);groups.append(wrap);
  }
  function render(current:RuntimeReport){
    live=current;recording=current.state==='recording'||current.state==='starting';
    const selected=history.selected,report=selected?selected.payload.runtime as RuntimeReport:current;
    historyBanner.hidden=!selected;historyBanner.replaceChildren();
    if(selected){historyBanner.append(h('strong',null,`${zh?'正在查看历史':'Viewing history'}: ${selected.entry.name}`),
      h('p','cm-muted',`${selected.entry.status==='interrupted'?zh?'中断，保存至':'Interrupted; saved through':zh?'快照保存至':'Snapshot saved through'} ${new Date(selected.entry.checkpointAt).toLocaleString(zh?'zh-CN':'en-US',{hour12:false})}${recording?zh?'；当前观察仍在后台继续。':'; current observation continues in the background.':''}`),
      ctx.ui.button(zh?'返回当前观察':'Back to current observation',{onClick:()=>history.current()}));}
    select.value=current.profile;select.disabled=recording;start.disabled=recording;stop.disabled=!recording;clear.disabled=recording;
    const statusText=`${stateText[report.state]} · ${m.reference}: ${report.profile==='v41'?'V4.1':'V4'}`;
    if(status.textContent!==statusText)status.textContent=statusText;
    status.dataset.state=report.state;
    const oldFrame=groups.querySelector('.cm-table-wrap');const groupLeft=oldFrame?.scrollLeft??0,groupTop=oldFrame?.scrollTop??0;
    stats.replaceChildren();groups.replaceChildren();const summary=h('div','cm-summary');
    for(const [label,value] of [[m.duration,number(report.durationMs/1000)],[m.calls,number(report.totals.providerRequests)],
      [m.input,number(report.totals.input)],[m.output,number(report.totals.output)],[m.cached,number(report.totals.cachedInput)],[m.uncached,number(report.totals.uncachedInput)],
      [m.reasoning,number(report.totals.reasoning)],[m.reports,number(report.totals.reportedRecords)],
      [m.cross,number(report.totals.boundaryRequests)],[m.crossTools,number(report.totals.boundaryTools)]]){
      const card=h('div','cm-stat');card.append(h('span','cm-muted',label),h('strong',null,value));summary.append(card);
    }
    stats.append(summary,h('p','cm-muted',`${m.source}: `+(['usage','index','tools','transcript'] as const).map(k=>`${m[k]}: ${sourceText[report.sources[k]]}`).join(' · ')));
    if(Object.keys(report.issues).length){const notices=h('p','cm-warning',m.coverage+': '+Object.entries(report.issues).map(([key,n])=>`${issues[key as RuntimeIssue]?.[zh?0:1]??m.unknown} (${n})`).join('；'));stats.append(notices);}
    if(report.truncated)stats.append(h('p','cm-warning',m.truncated));
    if(current.historySaveFailed)stats.append(h('p','cm-warning',zh?'临时记录保存失败；当前结果仍在内存，请先导出，检查本机保存状态后再清空。':'History could not be saved. Current results remain in memory; export them and check storage before clearing.'));
    table(m.groupTitle,m.groupHeaders,report.groups.map(g=>[g.owner,number(g.calls),number(g.perMinute),number(g.durationMs),number(g.failures),number(g.textTokens),`${g.measuredTexts} / ${g.unknownTexts}`,number(g.imageCount)]));
    const nextFrame=groups.querySelector('.cm-table-wrap');if(nextFrame){nextFrame.scrollLeft=groupLeft;nextFrame.scrollTop=groupTop;}
    merged.update(report);
  }
  async function action(method:'status'|'start'|'stop'|'clear',args:unknown[]=[]){
    if(busy||ctx.signal.aborted)return;busy=true;error.textContent='';
    start.disabled=true;stop.disabled=true;clear.disabled=true;
    if(method!=='status')history.current();
    try{const report=await ctx.invoke<RuntimeReport>(method,args);if(!ctx.signal.aborted){render(report);if(method!=='status'&&history.root.open)void history.refresh();}}
    catch{if(!ctx.signal.aborted){error.textContent=m.error;
      if(method!=='status')try{const report=await ctx.invoke<RuntimeReport>('status',[]);if(!ctx.signal.aborted)render(report);}catch{/* Keep previous statistics and fixed error text. */}
    }}
    finally{busy=false;if(!ctx.signal.aborted){start.disabled=recording;stop.disabled=!recording;clear.disabled=recording;}}
  }
  await action('status');
  if(!ctx.signal.aborted)ctx.interval(()=>{if(recording)void action('status');},1000);
}
