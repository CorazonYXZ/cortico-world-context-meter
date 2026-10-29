import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
export function dateView(ctx:WebUiPanelContext,value:string):HTMLElement {
  const h=ctx.ui.h,locale=ctx.language==='zh'||ctx.language==='zh-Hant'?'zh-CN':'en-US';
  const date=new Date(value),root=h('span','cm-datetime');
  root.title=value;
  root.append(h('span','cm-clock',date.toLocaleTimeString(locale,{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})),
    h('span','cm-date',date.toLocaleDateString(locale)));
  return root;
}
