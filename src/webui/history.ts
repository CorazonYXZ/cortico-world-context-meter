import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import type {HistoryList,HistoryEntry} from '../history-types.ts';
import type {StoredHistory} from '../history.ts';
export class HistoryControls {
  readonly root:HTMLDetailsElement;
  selected:StoredHistory|null=null;
  private readonly body:HTMLElement;
  private busy=false;
  private readonly zh:boolean;
  constructor(private readonly ctx:WebUiPanelContext,private readonly select:(record:StoredHistory|null)=>void){
    const h=ctx.ui.h;this.zh=ctx.language.startsWith('zh');
    this.root=h('details','cm-disclosure cm-history');this.root.dataset.control='history';
    this.body=h('div','cm-disclosure-body');
    this.root.append(h('summary',null,this.zh?'历史记录':'History'),this.body);
    this.root.addEventListener('toggle',()=>{if(this.root.open)void this.refresh();},{signal:ctx.signal});
  }
  current(){this.selected=null;this.select(null);}
  async refresh(){
    if(this.busy||this.ctx.signal.aborted)return;this.busy=true;const h=this.ctx.ui.h;
    try{
      const data=await this.ctx.invoke<HistoryList>('history.list',[]);if(this.ctx.signal.aborted)return;
      this.body.replaceChildren();
      this.body.append(h('p','cm-muted',this.zh?'自动保留 7 天、最多 30 次／64 MiB；清空当前结果不会删除历史。异常退出仅恢复最后成功快照。':'Kept for 7 days, up to 30 sessions / 64 MiB. Clearing current results preserves history. Interrupted sessions recover only the last saved snapshot.'));
      const controls=h('div','cm-controls');controls.append(this.ctx.ui.button(this.zh?'刷新列表':'Refresh list',{onClick:()=>{void this.refresh();}}),
        this.ctx.ui.button(this.zh?'返回当前观察':'Back to current observation',{onClick:()=>this.current()}));this.body.append(controls);
      if(data.warnings||data.saveFailed)this.body.append(h('p','cm-warning',this.zh?'部分历史无法读取或保存；内存中的当前结果仍保留。':'Some history could not be read or saved; current in-memory results are retained.'));
      if(!data.entries.length)this.body.append(h('p','cm-muted',this.zh?'尚无临时记录。':'No saved sessions yet.'));
      for(const entry of data.entries)this.body.append(this.row(entry));
    }catch{if(!this.ctx.signal.aborted)this.body.replaceChildren(h('p','cm-warning',this.zh?'历史记录暂不可用；请检查本机保存状态。':'History is unavailable. Check local storage.'));}
    finally{this.busy=false;}
  }
  private row(entry:HistoryEntry){
    const {ctx,zh}=this,h=ctx.ui.h,row=h('div','cm-history-row'),info=h('div'),actions=h('div','cm-history-actions');
    const when=(value:string)=>new Date(value).toLocaleString(zh?'zh-CN':'en-US',{hour12:false});
    const state=entry.status==='interrupted'?(zh?'中断，保存至':'Interrupted; saved through'):entry.status==='recording'?(zh?'观察中，保存至':'Recording; saved through'):(zh?'已停止':'Stopped');
    info.append(h('strong',null,entry.name),h('p','cm-muted',`${when(entry.startedAt)} — ${when(entry.endedAt??entry.checkpointAt)}`),
      h('p','cm-muted',`${entry.requests} ${zh?'请求':'requests'} · ${entry.totalTokens===null?'—':entry.totalTokens.toLocaleString()} token · ${state} ${when(entry.checkpointAt)} · ${entry.incomplete?zh?'统计可能不完整':'Coverage may be incomplete':zh?'无已报告缺失':'No reported gaps'}`));
    const error=h('p','cm-warning');error.setAttribute('role','alert');
    const perform=async(fn:()=>Promise<void>)=>{if(this.busy||ctx.signal.aborted)return;this.busy=true;error.textContent='';
      try{await fn();}catch{if(!ctx.signal.aborted)error.textContent=zh?'操作失败，请重试；未更改其他记录。':'Operation failed. Please retry; other sessions were not changed.';}finally{this.busy=false;}};
    const view=ctx.ui.button(zh?'查看':'View',{onClick:()=>{void perform(async()=>{
      const record=await ctx.invoke<StoredHistory>('history.get',[entry.id]);if(ctx.signal.aborted)return;this.selected=record;this.select(record);
    });}});view.dataset.historyView=entry.id;
    const edit=h('div','cm-history-edit');edit.hidden=true;const input=h('input');input.value=entry.name;input.maxLength=160;input.setAttribute('aria-label',zh?'记录名称':'Session name');
    edit.append(input,ctx.ui.button(zh?'保存名称':'Save name',{onClick:()=>{void perform(async()=>{
      const changed=await ctx.invoke<HistoryEntry>('history.rename',[entry.id,input.value]);
      if(ctx.signal.aborted)return;entry.name=changed.name;info.querySelector('strong')!.textContent=changed.name;edit.hidden=true;
      if(this.selected?.entry.id===entry.id){this.selected.entry.name=changed.name;this.selected.payload.selection.name=changed.name;this.select(this.selected);}
    });}}));
    const rename=ctx.ui.button(zh?'重命名':'Rename',{onClick:()=>{edit.hidden=!edit.hidden;if(!edit.hidden)input.focus();}});
    let confirm=false;const remove=ctx.ui.button(zh?'删除':'Delete',{onClick:()=>{
      if(!confirm){confirm=true;remove.textContent=zh?'确认删除此记录':'Confirm deletion';return;}
      void perform(async()=>{await ctx.invoke('history.delete',[entry.id]);if(ctx.signal.aborted)return;
        if(this.selected?.entry.id===entry.id)this.current();row.remove();
        if(!this.body.querySelector('.cm-history-row'))this.body.append(h('p','cm-muted',zh?'尚无临时记录。':'No saved sessions yet.'));});
    }});remove.disabled=entry.status==='recording';
    actions.append(view,rename,remove);row.append(info,actions,edit,error);return row;
  }
}
