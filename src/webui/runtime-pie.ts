import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import type {RuntimeReport} from '../runtime/types.ts';
import {pieSummary,pieColors,piePercent,ringPath,type PieCategory} from './runtime-pie-model.ts';

const words={
  zh:{title:'按关联工具汇总的请求 token',total:'已计总 token',shared:'多工具共享',none:'无关联工具',incomplete:'关联不完整',other:'其他',
    note:'这是按关联工具汇总的请求共享用量，不代表工具独立产生的费用。',
    coverage:'窗口内供应商请求',known:'计数完整',unknown:'计数未知，未计入',requests:'关联请求',source:'World 来源',
    empty:'暂无窗口内供应商请求。',allUnknown:'请求计数全部未知，暂无法绘制饼图。',zero:'已知请求总 token 为 0，不绘制扇区。',
    overflow:'合计超出安全数值范围，暂无法绘制饼图。',members:'查看其他分类',limit:'使用全部留存请求，不受表格排序及 200 行显示上限影响。未知请求不计入中心总数或占比。'},
  en:{title:'Request tokens grouped by linked tool',total:'Counted total tokens',shared:'Shared by multiple tools',none:'No linked tool',incomplete:'Incomplete links',other:'Other',
    note:'Shared request usage grouped by linked tool, not the tool’s independent cost.',
    coverage:'In-window provider requests',known:'Complete meters',unknown:'Unknown meters, excluded',requests:'Linked requests',source:'World source',
    empty:'No in-window provider requests yet.',allUnknown:'All request meters are unknown. No chart can be drawn.',zero:'Known request tokens total 0. No slices are drawn.',
    overflow:'The total exceeds the safe numeric range. No chart can be drawn.',members:'View other categories',limit:'Uses all retained requests, regardless of table sorting or the 200-row display limit. Unknown requests are excluded from the center total and percentages.'},
};

/** DOM/SVG only: this view neither reads data sources nor creates workers or network requests. */
export class RuntimePie {
  readonly root:HTMLElement;
  private readonly coverage:HTMLElement;
  private readonly state:HTMLElement;
  private readonly layout:HTMLElement;
  private readonly legend:HTMLElement;
  private readonly svg:SVGSVGElement;
  private readonly center:SVGTextElement;
  private readonly arcs:SVGGElement;
  private readonly details:HTMLDetailsElement;
  private readonly members:HTMLElement;
  private readonly colors=new Map<string,string>();
  private active:string|null=null;
  private window:string|null=null;
  private readonly m;
  constructor(private readonly ctx:WebUiPanelContext){
    const h=ctx.ui.h;this.m=words[ctx.language.startsWith('zh')?'zh':'en'];const m=this.m;
    this.root=h('section','cm-pie');this.root.hidden=true;this.root.setAttribute('aria-label',m.title);
    this.coverage=h('p','cm-table-caption');this.state=h('p','cm-pie-state');this.state.setAttribute('role','status');
    this.layout=h('div','cm-pie-layout');this.legend=h('div','cm-pie-legend');this.legend.setAttribute('role','group');this.legend.setAttribute('aria-label',m.title);
    const ns='http://www.w3.org/2000/svg',document=ctx.root.ownerDocument;
    this.svg=document.createElementNS(ns,'svg');this.svg.setAttribute('viewBox','0 0 360 360');this.svg.classList.add('cm-pie-svg');this.svg.setAttribute('role','group');this.svg.setAttribute('aria-label',m.title);
    const label=document.createElementNS(ns,'text');label.setAttribute('x','180');label.setAttribute('y','169');label.setAttribute('text-anchor','middle');label.classList.add('cm-pie-center-label');label.textContent=m.total;
    this.center=document.createElementNS(ns,'text');this.center.setAttribute('x','180');this.center.setAttribute('y','203');this.center.setAttribute('text-anchor','middle');this.center.classList.add('cm-pie-center-total');
    this.arcs=document.createElementNS(ns,'g');this.svg.append(this.arcs,label,this.center);
    this.layout.append(this.legend,this.svg);
    this.details=h('details','cm-pie-other');const summary=h('summary',null,m.members);this.members=h('div','cm-pie-members');this.details.append(summary,this.members);this.details.hidden=true;
    this.root.append(h('p','cm-table-caption',m.note),this.coverage,h('p','cm-table-caption',m.limit),this.state,this.layout,this.details);
  }
  private number(value:number){return value.toLocaleString(this.ctx.language.startsWith('zh')?'zh-CN':'en-US');}
  private name(c:PieCategory){return c.kind==='tool'?c.tool:this.m[c.kind];}
  private describe(c:PieCategory,total:number){return `${this.name(c)}${c.owner?` · ${this.m.source}: ${c.owner}`:''} · ${this.number(c.tokens)} token · ${piePercent(c.tokens,total,this.ctx.language)} · ${this.m.requests}: ${this.number(c.requests)}`;}
  private highlight(key:string|null){
    this.active=key;
    for(const item of this.root.querySelectorAll<HTMLElement|SVGElement>('[data-pie-key]')){
      item.classList.toggle('cm-pie-active',item.dataset.pieKey===key);item.classList.toggle('cm-pie-muted',key!==null&&item.dataset.pieKey!==key);
      if(item.getAttribute('role')==='button'||item.tagName==='BUTTON')item.setAttribute('aria-pressed',String(item.dataset.pieKey===key));
    }
  }
  update(report:RuntimeReport){
    if(this.ctx.signal.aborted)return;
    if(this.window!==report.startedAt){this.window=report.startedAt;this.active=null;this.details.open=false;this.colors.clear();}
    const model=pieSummary(report),m=this.m;
    this.root.dataset.state=model.state;this.root.dataset.total=model.total===null?'':String(model.total);
    this.coverage.textContent=`${m.coverage}: ${this.number(model.eligible)} · ${m.known}: ${this.number(model.known)} · ${m.unknown}: ${this.number(model.unknown)}`;
    this.state.textContent=model.state==='empty'?m.empty:model.state==='unknown'?m.allUnknown:model.state==='zero'?m.zero:model.state==='overflow'?m.overflow:'';
    this.state.hidden=model.state==='ready';this.layout.hidden=model.state==='empty'||model.state==='unknown'||model.state==='overflow';
    this.svg.style.display=model.state==='ready'?'':'none';this.center.textContent=model.total===null?'—':this.number(model.total);
    // Keep existing visible categories' colors first; new categories take an unused palette color.
    const keys=new Set(model.slices.map(s=>s.key)),used=new Set([...this.colors].filter(([key])=>keys.has(key)).map(([,color])=>color));
    for(const key of [...this.colors.keys()])if(!keys.has(key))this.colors.delete(key);
    for(const slice of model.slices)if(!this.colors.has(slice.key)){const color=pieColors.find(c=>!used.has(c))!;this.colors.set(slice.key,color);used.add(color);}
    if(this.active&&!keys.has(this.active))this.active=null;
    const active=this.active;
    const document=this.ctx.root.ownerDocument,focused=document.activeElement as HTMLElement|null;
    const focusKey=this.root.contains(focused)?focused?.dataset.pieKey:undefined;
    const focusArc=focused?.namespaceURI==='http://www.w3.org/2000/svg';
    const top=this.members.scrollTop;
    this.legend.replaceChildren();this.arcs.replaceChildren();this.members.replaceChildren();
    const h=this.ctx.ui.h;let angle=-Math.PI/2;
    for(const slice of model.slices){
      const description=this.describe(slice,model.total??0),button=h('button','cm-pie-item');button.type='button';button.dataset.pieKey=slice.key;button.title=description;
      const swatch=h('span','cm-pie-swatch');swatch.style.backgroundColor=this.colors.get(slice.key)!;swatch.setAttribute('aria-hidden','true');
      const name=h('span','cm-pie-name',this.name(slice)),text=h('span','cm-pie-text');text.append(name);
      if(slice.owner)text.append(h('span','cm-pie-source',`${m.source}: ${slice.owner}`));
      text.append(h('span','cm-pie-values',`${this.number(slice.tokens)} token · ${piePercent(slice.tokens,model.total??0,this.ctx.language)} · ${m.requests}: ${this.number(slice.requests)}`));
      button.append(swatch,text);button.setAttribute('aria-label',description);
      button.addEventListener('mouseenter',()=>this.highlight(slice.key));button.addEventListener('focus',()=>this.highlight(slice.key));
      button.addEventListener('click',()=>this.highlight(slice.key));button.addEventListener('keydown',event=>{if(event.key==='Escape')this.highlight(null);});this.legend.append(button);
      if(model.state==='ready'&&slice.tokens>0){
        const next=angle+slice.tokens/model.total!*Math.PI*2,path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',ringPath(angle,next));path.setAttribute('fill',this.colors.get(slice.key)!);path.setAttribute('tabindex','0');path.setAttribute('role','button');path.setAttribute('aria-label',description);path.dataset.pieKey=slice.key;
        const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=description;path.append(title);
        path.addEventListener('mouseenter',()=>this.highlight(slice.key));path.addEventListener('focus',()=>this.highlight(slice.key));path.addEventListener('click',()=>this.highlight(slice.key));
        path.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();this.highlight(slice.key);}if(event.key==='Escape')this.highlight(null);});
        this.arcs.append(path);angle=next;
      }
      for(const member of slice.members){const row=h('div','cm-pie-member');row.append(h('strong',null,this.name(member)),h('span',null,`${m.source}: ${member.owner||'—'}`),h('span','cm-pie-values',`${this.number(member.tokens)} token · ${piePercent(member.tokens,model.total??0,this.ctx.language)} · ${m.requests}: ${this.number(member.requests)}`));this.members.append(row);}
    }
    this.details.hidden=!model.slices.some(s=>s.members.length);this.members.scrollTop=top;
    if(focusKey){const candidates=[...this.root.querySelectorAll<HTMLElement|SVGElement>('[data-pie-key]')];const next=candidates.find(e=>e.dataset.pieKey===focusKey&&(e.namespaceURI==='http://www.w3.org/2000/svg')===focusArc);next?.focus({preventScroll:true});}
    this.highlight(active);
  }
}
