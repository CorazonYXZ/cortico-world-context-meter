import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import type {RuntimeReport,RuntimeTool} from '../runtime/types.ts';
import {mergedRows,type MergedRow} from './runtime-view.ts';
import {dateView} from './ui.ts';
import {sortRows,defaultSort,isSort,sortColumns,type Column,type SortChoice} from './runtime-sort.ts';
import {RuntimePie} from './runtime-pie.ts';

type Mode='simple'|'detailed'|'pie';
const simple:Column[]=['time','tool','input','output','cached','uncached','reasoning','total','link'];
const detailed:Column[]=[...simple,'owner','role','model','basis','toolTime','duration','failed','text','textBasis','images','imageBound','toolLink'];
const toolColumns:Column[]=['tool','owner','toolTime','duration','failed','text','textBasis','images','imageBound','toolLink'];
const numeric=new Set<Column>(['input','output','cached','uncached','reasoning','total','duration','text','images','imageBound']);
const messages={
  zh:{title:'请求与关联工具',simple:'简单',detailed:'详细',pie:'饼图',view:'数据显示方式',
    shared:'这里是关联请求的共享用量，不代表该工具独立产生的费用。总 token = 输入＋输出，缓存和推理不重复相加。',
    none:'尚无记录。',noTools:'未关联工具／无可见明细',unmatched:'未关联请求',ambiguous:'关联不唯一',pending:'待配对工具',
    details:'工具明细',expand:'展开',collapse:'收起',perTool:'多个工具，请展开逐项明细',
    detailNote:'逐工具信息；请求用量只在主行显示一次。',inside:'窗口内',cross:'跨边界／起点未知',
    provider:'供应商回执',reported:'扩展自报，单列',full:'完整结果流水',receipt:'已验证完整的短回执',unknown:'未知',yes:'是',no:'否',
    shown:'当前显示',rows:'行',requests:'请求',unlinked:'未关联工具',limit:'每张表最多显示 200 行，关联与汇总使用全部留存记录。',
    headers:{time:'完成时间',tool:'工具',input:'输入',output:'输出',cached:'缓存输入',uncached:'未缓存输入',reasoning:'推理输出',
      total:'总 token（输入＋输出）',link:'本响应发起的工具／边界',owner:'World 来源',role:'角色／来源',model:'模型',basis:'回执类型／状态',
      toolTime:'工具完成时间',duration:'工具耗时 ms',failed:'记录失败',text:'文本估算 token',textBasis:'文本依据',images:'图片附件',imageBound:'Flash 条件上限',toolLink:'工具请求关联／边界'},
  },
  en:{title:'Requests and linked tools',simple:'Simple',detailed:'Detailed',pie:'Pie chart',view:'Data view',
    shared:'Shared usage of a linked request, not this tool’s independent cost. Total tokens = input + output; cache and reasoning are not added again.',
    none:'No records yet.',noTools:'No linked tool / details not visible',unmatched:'No linked request',ambiguous:'Ambiguous link',pending:'Pending tool links',
    details:'Tool details',expand:'Expand',collapse:'Collapse',perTool:'Multiple tools: expand for individual details',
    detailNote:'Individual tool details; request usage appears only once in the main row.',inside:'Within window',cross:'Cross-boundary / unknown start',
    provider:'Provider meters',reported:'World-reported, separate',full:'Full transcript result',receipt:'Verified complete short receipt',unknown:'Unknown',yes:'Yes',no:'No',
    shown:'Showing',rows:'rows',requests:'requests',unlinked:'unlinked tools',limit:'At most 200 rows per table. Joins and aggregates use all retained records.',
    headers:{time:'Completed',tool:'Tool',input:'Input',output:'Output',cached:'Cached input',uncached:'Uncached input',reasoning:'Reasoning output',
      total:'Total tokens (input + output)',link:'Tools initiated by response / boundary',owner:'World source',role:'Role / source',model:'Model',basis:'Meter basis / outcome',
      toolTime:'Tool completed',duration:'Tool duration ms',failed:'Marked failed',text:'Text token estimate',textBasis:'Text basis',images:'Image attachments',imageBound:'Conditional Flash bound',toolLink:'Tool request link / boundary'},
  },
};

/** The element is kept alive across report updates so view controls and the scroll container remain stable. */
export class RuntimeTable {
  readonly root:HTMLElement;
  readonly frame:HTMLDivElement;
  readonly interactions:HTMLElement;
  private readonly table:HTMLTableElement;
  private readonly head:HTMLTableSectionElement;
  private readonly body:HTMLTableSectionElement;
  private readonly caption:HTMLElement;
  private readonly buttons:Record<Mode,HTMLButtonElement>;
  private readonly pie:RuntimePie;
  private readonly sortBox:HTMLDetailsElement;
  private readonly shared:HTMLElement;
  private readonly expanded=new Set<string>();
  private readonly rowElements=new Map<string,HTMLTableRowElement>();
  private readonly focusButtons=new Map<string,HTMLButtonElement>();
  private mode:Mode='simple';
  private last:RuntimeReport|null=null;
  private visible:MergedRow[]=[];
  private window:string|null=null;
  private readonly m;
  private sort:SortChoice={...defaultSort};
  constructor(private readonly ctx:WebUiPanelContext){
    const h=ctx.ui.h;this.m=messages[ctx.language==='zh'||ctx.language==='zh-Hant'?'zh':'en'];const m=this.m;
    try{const saved=ctx.memo?.get<string>('context-meter.runtimeView','simple');if(saved==='detailed'||saved==='pie')this.mode=saved;}catch{/* A display preference is optional. */}
    try{const saved=ctx.memo?.get<unknown>('context-meter.runtimeSort',null);if(isSort(saved))this.sort=saved;}catch{/* Optional preference. */}
    this.root=h('section','cm-merged');
    const toolbar=h('div','cm-table-toolbar'),toggle=h('div','cm-view-toggle');toggle.setAttribute('role','group');toggle.setAttribute('aria-label',m.view);
    this.buttons={simple:ctx.ui.button(m.simple,{onClick:()=>this.setMode('simple')}),detailed:ctx.ui.button(m.detailed,{onClick:()=>this.setMode('detailed')}),pie:ctx.ui.button(m.pie,{onClick:()=>this.setMode('pie')})};
    for(const mode of ['simple','detailed','pie'] as const){this.buttons[mode].dataset.view=mode;toggle.append(this.buttons[mode]);}
    toolbar.append(h('h3',null,m.title),toggle);this.caption=h('p','cm-table-caption');
    this.frame=h('div','cm-table-wrap cm-merged-scroll');this.frame.tabIndex=0;this.frame.setAttribute('role','region');this.frame.setAttribute('aria-label',m.title);
    this.table=h('table','cm-table cm-merged-table');this.table.setAttribute('aria-label',m.title);
    this.head=h('thead');this.body=h('tbody');this.table.append(this.head,this.body);this.frame.append(this.table);
    this.interactions=h('div','cm-interactions');
    const sortBox=h('details','cm-disclosure cm-sort'),summary=h('summary',null,ctx.language.startsWith('zh')?'排序':'Sort');
    this.sortBox=sortBox;this.pie=new RuntimePie(ctx);this.shared=h('p','cm-table-caption',m.shared);
    const zh=ctx.language.startsWith('zh'),content=h('div','cm-disclosure-body');
    const column=h('select'),direction=h('select');column.dataset.sort='column';direction.dataset.sort='direction';
    column.setAttribute('aria-label',zh?'排序列':'Sort column');direction.setAttribute('aria-label',zh?'排序方向':'Sort direction');
    const refreshOptions=()=>{column.replaceChildren();for(const key of sortColumns){const o=h('option',null,m.headers[key]+(!this.columns.includes(key)?zh?'（详细列）':' (detailed column)':''));o.value=key;column.append(o);}column.value=this.sort.column;};
    for(const [value,text] of [['desc',zh?'降序':'Descending'],['asc',zh?'升序':'Ascending']]){const o=h('option',null,text);o.value=value;direction.append(o);}direction.value=this.sort.direction;
    const change=()=>{this.sort={column:column.value as Column,direction:direction.value as 'asc'|'desc'};
      try{ctx.memo?.set('context-meter.runtimeSort',this.sort);}catch{/* Optional preference. */}
      if(this.last){this.update(this.last);this.frame.scrollTop=0;}};
    column.addEventListener('change',change,{signal:ctx.signal});direction.addEventListener('change',change,{signal:ctx.signal});
    const reset=ctx.ui.button(zh?'恢复默认':'Reset',{onClick:()=>{column.value='time';direction.value='desc';change();}});
    content.append(column,direction,reset,h('p','cm-muted',zh?'多工具数值按合计排序，任一未知则放末尾；完成时间取最晚，失败按任一失败。仅改变排序，不改变逐工具数据或费用归属。':'Multiple tools sort by sums; any unknown value sorts last. Latest tool completion and any-failed status are used. Individual data and cost attribution stay unchanged.'));
    sortBox.append(summary,content);this.interactions.append(sortBox);
    this.root.append(toolbar,this.interactions,this.shared,this.caption,this.frame,this.pie.root);
    for(const button of Object.values(this.buttons))button.addEventListener('click',refreshOptions,{signal:ctx.signal});refreshOptions();
    this.body.addEventListener('click',event=>{
      const target=event.target as HTMLElement|null;
      const button=target?.closest<HTMLButtonElement>('button[data-expand]');
      const key=button?.dataset.expand;
      if(!key||!this.rowElements.has(key))return;
      if(this.expanded.has(key))this.expanded.delete(key);else this.expanded.add(key);
      this.renderRows(true);
    },{signal:ctx.signal});
    this.renderHead();
  }
  private get columns(){return this.mode==='detailed'?detailed:simple;}
  private setMode(mode:Mode){
    if(this.ctx.signal.aborted||this.mode===mode)return;
    this.mode=mode;try{this.ctx.memo?.set('context-meter.runtimeView',mode);}catch{/* Keep the in-memory choice. */}
    this.renderHead();
    if(this.last){if(mode==='pie')this.pie.update(this.last);else this.renderRows(false);}
  }
  private renderHead(){
    const h=this.ctx.ui.h,tr=h('tr');
    for(const key of this.columns){const th=h('th',this.cellClass(key),this.m.headers[key]);th.scope='col';th.dataset.column=key;
      if(key==='total')th.title=this.m.shared;tr.append(th);}
    this.head.replaceChildren(tr);this.table.classList.toggle('cm-detailed',this.mode==='detailed');
    const pie=this.mode==='pie';this.pie.root.hidden=!pie;this.frame.hidden=pie;this.sortBox.hidden=pie;this.caption.hidden=pie;this.shared.hidden=pie;
    for(const mode of ['simple','detailed','pie'] as const)this.buttons[mode].setAttribute('aria-pressed',String(mode===this.mode));
  }
  update(report:RuntimeReport):void {
    if(this.ctx.signal.aborted)return;
    if(this.window!==report.startedAt){this.expanded.clear();this.window=report.startedAt;}
    this.last=report;
    const all=sortRows(mergedRows(report),this.sort,this.ctx.language);this.visible=all.slice(0,200);
    this.caption.textContent=`${this.m.shown} ${this.visible.length} / ${all.length} ${this.m.rows} · ${report.requests.length} ${this.m.requests} · ${all.filter(r=>!r.request).length} ${this.m.unlinked}. ${this.m.limit}`;
    if(this.mode==='pie')this.pie.update(report);else this.renderRows(true);
  }
  private number(value:number|null){return value===null?'—':value.toLocaleString(this.ctx.language==='zh'||this.ctx.language==='zh-Hant'?'zh-CN':'en-US',{maximumFractionDigits:1});}
  private cellClass(key:Column){return [numeric.has(key)?'cm-number':'',key==='tool'?'cm-tool-frozen':'',key==='total'?'cm-total':''].filter(Boolean).join(' ');}
  private toolLink(row:MergedRow,tool:RuntimeTool):string {
    const refs=row.request?[row.request.id]:row.candidateRequests;
    return `${refs.map(id=>id.slice(0,8)).join(', ')||this.m.unmatched} · ${tool.boundary?this.m.cross:this.m.inside}`;
  }
  private toolValue(row:MergedRow,tool:RuntimeTool,key:Column):string|HTMLElement {
    switch(key){
      case 'tool':return tool.tool;
      case 'owner':return tool.owner;
      case 'toolTime':return dateView(this.ctx,tool.at);
      case 'duration':return this.number(tool.durationMs);
      case 'failed':return tool.failed===null?'—':tool.failed?this.m.yes:this.m.no;
      case 'text':return this.number(tool.textTokens);
      case 'textBasis':return tool.textBasis==='transcript'?this.m.full:tool.textBasis==='complete_receipt'?this.m.receipt:this.m.unknown;
      case 'images':return this.number(tool.imageCount);
      case 'imageBound':return tool.flashImageUpperBound===null?'—':`≤ ${this.number(tool.flashImageUpperBound)} *`;
      case 'toolLink':return this.toolLink(row,tool);
      default:return '—';
    }
  }
  private toolCell(row:MergedRow):HTMLElement {
    const h=this.ctx.ui.h,root=h('div');
    if(!row.tools.length)root.append(h('span','cm-muted',this.m.noTools));
    for(const tool of row.tools.slice(0,200)){
      const item=h('div','cm-tool-item');item.append(h('span','cm-tool-name',tool.tool),h('span','cm-owner',tool.owner));root.append(item);
    }
    if(!row.request)root.append(h('span','cm-issues',row.link==='ambiguous'?this.m.ambiguous:this.m.unmatched));
    if(row.pendingLinks)root.append(h('span','cm-issues',`${this.m.pending}: ${row.pendingLinks}`));
    if(row.tools.length>200)root.append(h('span','cm-issues',this.m.limit));
    if(this.mode==='detailed'&&row.tools.length>1){
      const button=h('button','cm-expand',`${this.expanded.has(row.key)?this.m.collapse:this.m.expand} ${this.m.details} (${row.tools.length})`);
      button.type='button';button.dataset.expand=row.key;button.dataset.focusKey=row.key;button.setAttribute('aria-expanded',String(this.expanded.has(row.key)));
      this.focusButtons.set(row.key,button);root.append(button);
    }
    return root;
  }
  private value(row:MergedRow,key:Column):string|HTMLElement {
    const request=row.request;
    if(key==='time')return dateView(this.ctx,row.at);
    if(key==='tool')return this.toolCell(row);
    if(key==='total')return this.number(row.totalTokens);
    if(['input','output','cached','uncached','reasoning'].includes(key)){
      const fields={input:'input',output:'output',cached:'cachedInput',uncached:'uncachedInput',reasoning:'reasoning'} as const;
      return this.number(request?.[fields[key as keyof typeof fields]]??null);
    }
    if(key==='link')return request?`${request.id.slice(0,8)} · ${request.tools.length} · ${request.boundary?this.m.cross:this.m.inside}`:
      row.link==='ambiguous'?`${this.m.ambiguous} (${row.candidateRequests.length})`:this.m.unmatched;
    if(key==='role')return request?.role??row.tools[0]?.role??'—';
    if(key==='model')return request?.model??'—';
    if(key==='basis')return request?`${request.basis==='provider'?this.m.provider:this.m.reported} / ${request.outcome}`:this.m.unmatched;
    if(key==='owner')return [...new Set(row.tools.map(t=>t.owner))].join(', ')||'—';
    if(row.tools.length===1)return this.toolValue(row,row.tools[0],key);
    return row.tools.length>1&&key==='toolTime'?this.m.perTool:'—';
  }
  private appendCell(tr:HTMLTableRowElement,key:Column,value:string|HTMLElement){
    const td=this.ctx.ui.h('td',this.cellClass(key));td.dataset.column=key;
    if(typeof value==='string')td.textContent=value;else td.append(value);tr.append(td);
  }
  private details(row:MergedRow):HTMLTableRowElement {
    const h=this.ctx.ui.h,tr=h('tr','cm-detail-row'),td=h('td');td.colSpan=this.columns.length;
    const panel=h('div','cm-detail-panel'),table=h('table','cm-table'),head=h('thead'),header=h('tr'),body=h('tbody');
    panel.append(h('p','cm-muted',`${this.m.details} · ${row.request?.id.slice(0,8)??''}. ${this.m.detailNote} ${row.tools.length>200?this.m.limit:''}`));
    for(const key of toolColumns){const th=h('th',this.cellClass(key),this.m.headers[key]);th.scope='col';header.append(th);}head.append(header);
    for(const tool of row.tools.slice(0,200)){const child=h('tr');for(const key of toolColumns)this.appendCell(child,key,this.toolValue(row,tool,key));body.append(child);}
    table.append(head,body);panel.append(table);td.append(panel);tr.append(td);return tr;
  }
  private renderRows(preserveHorizontal:boolean){
    if(!this.last)return;
    const h=this.ctx.ui.h,top=this.frame.scrollTop,left=this.frame.scrollLeft;
    const frameTop=this.frame.getBoundingClientRect().top;
    let anchor:{key:string;offset:number}|null=null;
    if(top>0)for(const [key,row] of this.rowElements){const rect=row.getBoundingClientRect();if(rect.height>0&&rect.bottom>frameTop+this.head.getBoundingClientRect().height){anchor={key,offset:rect.top-frameTop};break;}}
    const focus=this.ctx.root.ownerDocument.activeElement as HTMLElement|null;
    const focusKey=this.body.contains(focus)?focus?.dataset.focusKey:undefined;
    this.rowElements.clear();this.focusButtons.clear();
    const rows:HTMLTableRowElement[]=[];
    for(const row of this.visible){
      const tr=h('tr',row.request?null:'cm-orphan');tr.dataset.rowKey=row.key;tr.dataset.kind=row.request?'request':'unlinked';
      for(const key of this.columns)this.appendCell(tr,key,this.value(row,key));
      rows.push(tr);this.rowElements.set(row.key,tr);
      if(this.mode==='detailed'&&row.tools.length>1&&this.expanded.has(row.key))rows.push(this.details(row));
    }
    if(!rows.length){const tr=h('tr'),td=h('td','cm-muted',this.m.none);td.colSpan=this.columns.length;tr.append(td);rows.push(tr);}
    this.body.replaceChildren(...rows);this.frame.scrollTop=top;
    if(anchor){const next=this.rowElements.get(anchor.key);if(next)this.frame.scrollTop+=next.getBoundingClientRect().top-this.frame.getBoundingClientRect().top-anchor.offset;}
    this.frame.scrollLeft=preserveHorizontal?left:0;
    if(focusKey)this.focusButtons.get(focusKey)?.focus({preventScroll:true});
  }
}
