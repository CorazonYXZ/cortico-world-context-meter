import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { ExtensionEstimate, Issue, Profile, ScanReport, Status } from '../types.ts';
import './style.css';
import {mountRuntime} from './runtime.ts';
import {dateView} from './ui.ts';
import {exportControls} from './export.ts';

const messages={
  zh:{title:'扩展静态上下文排行',declaration:'声明',before: '：本页仅为',warning:'静态估算，不是实际请求、账单或节省金额',
    scope:'。统计只比较已安装包（含未启用包）自带的工具声明与原始提示词模板，不判断当前实际发送了哪些内容；不读取聊天、记忆、工具回执或密钥。需要动态观察请移步“运行观察”页。',
    tokenizer:'参考分词器',refresh:'刷新统计',loading:'正在本机统计…',failed:'统计失败，请重试。',empty:'没有发现直接安装的扩展。',
    missing:'未找到框架指定的扩展目录或依赖清单。',unreadable:'无法读取扩展依赖清单；未扫描其他目录。',
    sum:'已统计声明 token',coverage:'声明完整 / 部分 / 无法评估',updated:'统计时间',
    headers:['包名','类别','工具数','工具声明 token','模板 token','合计','已统计占比','数据完整性'],
    complete:'完整声明',partial:'部分可评估',unavailable:'无法评估',not_applicable:'不适用',
    note:'“完整”仅表示声明数据可解析；不代表实际运行内容完整。模板变量不展开，共享协议开销、输出及缓存费用不计入。',
    profileNote:'V4.1 为 DeepSeek 官方 recipe 的家族参考分词器，原始对照模型是 V4-Flash-Vision-Exp；用于 Flash 的文本体积比较，不保证与服务端计数相同。',
    pending:'分词器已选择，点击“刷新统计”后应用。',resultProfile:'本次结果参考',
  },
  en:{title:'Declared context ranking',declaration:'Notice',before: ': This page provides only a ',warning:'static estimate, not actual requests, bills or savings',
    scope:'. It compares bundled tool declarations and raw prompt templates of installed packages, including inactive packages, without determining what is actually sent. It reads no chat, memory, tool results or keys. For dynamic observation, use the “Runtime observation” page.',
    tokenizer:'Reference tokenizer',refresh:'Refresh',loading:'Calculating locally…',failed:'Scan failed. Please try again.',empty:'No directly installed extensions found.',
    missing:'The configured extension directory or dependency manifest was not found.',unreadable:'Cannot read the extension dependency manifest. No other directories were scanned.',
    sum:'Measured declaration tokens',coverage:'Complete / partial / unavailable',updated:'Scanned at',
    headers:['Package','Kind','Tools','Tool tokens','Template tokens','Total','Measured share','Data status'],
    complete:'Complete declarations',partial:'Partially measurable',unavailable:'Unavailable',not_applicable:'Not applicable',
    note:'“Complete” describes parsable declarations, not complete runtime coverage. Template variables stay unexpanded. Shared protocol overhead, output and cache charges are excluded.',
    profileNote:'V4.1 uses the DeepSeek official recipe family reference, originally compared against V4-Flash-Vision-Exp. It is a text-size reference for Flash, not a guarantee of server-side token counts.',
    pending:'Tokenizer selected. Click Refresh to apply.',resultProfile:'Reference used',
  },
};
const issueText:Record<Issue,[string,string]>={
  manifest_unreadable:['包清单不可读','Package manifest unreadable'],invalid_manifest:['包声明不合格','Invalid package manifest'],
  missing_description:['未声明自描述文件','No self-description declared'],description_unreadable:['自描述不可读或不合格','Self-description unreadable or invalid'],
  unsafe_path:['声明文件路径不合格','Unsafe declaration path'],oversized_file:['声明文件超过大小限制','Declaration exceeds size limit'],
  invalid_tools:['工具列表缺失或不合格','Tool list missing or invalid'],invalid_tool:['部分工具声明不合格','Some tool declarations are invalid'],
  duplicate_tool:['相同工具已去重','Identical tools deduplicated'],conflicting_tool:['同名冲突工具未计入','Conflicting tool names excluded'],
  invalid_prompts:['模板列表不合格','Invalid template list'],invalid_prompt:['部分模板不合格','Some templates are invalid'],
  duplicate_prompt:['相同模板已去重','Identical templates deduplicated'],conflicting_prompt:['同名冲突模板未计入','Conflicting template keys excluded'],
};
function profileLabel(profile:Profile):string {
  return profile==='v41'?'DeepSeek-V4.1-Flash / V4.1 reference':'DeepSeek-V4-Pro / V4 reference';
}

export async function mount(ctx:WebUiPanelContext):Promise<void> {
  const zh=ctx.language==='zh' || ctx.language==='zh-Hant';
  const m=messages[zh?'zh':'en'];
  const h=ctx.ui.h;
  const wrapper=h('section','context-meter');
  const title=h('h2',null,m.title);
  const declaration=h('p');declaration.append(h('strong',null,m.declaration),m.before,h('strong',null,m.warning),m.scope);
  const controls=h('div','cm-controls');
  const label=h('label',null,m.tokenizer);
  const select=h('select','field');
  select.setAttribute('aria-label',m.tokenizer);
  for(const profile of ['v41','v4'] as const) {
    const option=h('option',null,profileLabel(profile)); option.value=profile; select.append(option);
  }
  label.append(select);
  const refresh=ctx.ui.button(m.refresh,{onClick:()=>{void run(select.value as Profile);}});
  refresh.classList.add('cm-primary');
  const exporter=exportControls(ctx);
  controls.append(label,refresh,exporter.format,exporter.button);
  const status=h('p','cm-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const results=h('div');
  select.addEventListener('change',()=>{status.textContent=m.pending;},{signal:ctx.signal});
  const intro=h('div','cm-intro cm-copy-intro');intro.append(declaration);
  const notes=h('div','cm-notes cm-copy-notes');notes.append(h('p',null,m.note),h('p',null,m.profileNote));
  wrapper.append(title,intro,controls,exporter.notice,status,results,notes);
  ctx.root.append(wrapper);
  let busy=false;
  const number=(n:number|null)=>n===null?'—':n.toLocaleString(zh?'zh-CN':'en-US');
  const cell=(text:string)=>h('td',null,text);
  function render(report:ScanReport) {
    results.replaceChildren();
    select.value=report.profile;
    const summary=h('div','cm-summary');
    for(const [label,value] of [[m.sum,number(report.measuredTokens)],[m.coverage,`${report.completeCount} / ${report.partialCount} / ${report.unavailableCount}`],
      [m.resultProfile,profileLabel(report.profile)],[m.updated,report.estimatedAt]]) {
      const card=h('div','cm-stat'+(label===m.resultProfile||label===m.updated?' cm-stat-text':'')),strong=h('strong');
      if(label===m.updated)strong.append(dateView(ctx,value));else strong.textContent=value;
      card.append(h('span','cm-muted',label),strong);summary.append(card);
    }
    results.append(summary);
    if(report.directoryStatus!=='ok') { results.append(h('p',null,report.directoryStatus==='missing'?m.missing:m.unreadable));return; }
    if(!report.rows.length) { results.append(h('p',null,m.empty));return; }
    const scroll=h('div','cm-table-wrap');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',m.title);
    const table=h('table','cm-table');
    const head=h('thead');const header=h('tr');
    for(const [index,label] of m.headers.entries()){const th=h('th',index>=2&&index<=6?'cm-number':null,label);th.scope='col';header.append(th);}head.append(header);
    const body=h('tbody');
    for(const row of report.rows) body.append(renderRow(row));
    table.append(head,body);scroll.append(table);results.append(scroll);
  }
  function renderRow(row:ExtensionEstimate) {
    const tr=h('tr');
    const statusCell=cell(m[row.status as Status]);
    if(row.issues.length) {
      const notes=h('span','cm-issues',row.issues.map(i=>issueText[i][zh?0:1]).join('；'));
      statusCell.append(notes);
    }
    tr.append(cell(row.name),cell(row.kind),cell(number(row.toolCount)),cell(number(row.toolTokens)),cell(number(row.promptTokens)),cell(number(row.totalTokens)),
      cell(row.share===null?'—':`${(row.share*100).toFixed(1)}%`),statusCell);
    for(const index of [2,3,4,5,6])tr.children[index].classList.add('cm-number');
    return tr;
  }
  async function run(profile?:Profile):Promise<void> {
    if(busy || ctx.signal.aborted) return;
    busy=true;refresh.disabled=true;select.disabled=true;status.textContent=m.loading;results.replaceChildren();
    try {
      const report=await ctx.invoke<ScanReport>('scan',profile?[profile]:[]);
      if(ctx.signal.aborted) return;
      render(report);status.textContent='';
    } catch {
      if(!ctx.signal.aborted) status.textContent=m.failed;
    } finally {
      busy=false;refresh.disabled=false;select.disabled=false;
    }
  }
  await run();
}
export default {panels:{overview:{mount},runtime:{mount:mountRuntime}}};
