import type {WebUiPanelContext} from 'cortico/web/shared/client-panel.ts';
import type {StatisticsExport} from '../export.ts';
import {XLSX_MIME,exportCode,type ExportCode} from '../excel-protocol.ts';
import pkg from '../../package.json' with {type:'json'};
const errors:Record<ExportCode,[string,string]>={
  E_EXPORT_DATA:['无法取得所选统计，请检查该记录是否仍存在。','Selected statistics are unavailable. Check that the session still exists.'],
  E_EXPORT_ARGS:['导出参数不兼容，请重新打开面板。','Export parameters are incompatible. Reopen the panel.'],
  E_EXPORT_INTERFACE:['宿主缺少所需的二进制导出接口。','The host lacks the required binary export interface.'],
  E_EXPORT_TRANSPORT:['Excel 文件传输失败，请重试。','Excel transfer failed. Please retry.'],
  E_EXPORT_DOWNLOAD:['文件已取得，但准备下载失败，请重试。','The file was received but download preparation failed. Please retry.'],
  E_XLSX_BUSY:['已有 Excel 正在生成，请稍后重试。','An Excel export is already running. Retry after it finishes.'],
  E_XLSX_START:['本机 Excel 线程启动失败，请检查安装是否完整。','The local Excel worker could not start. Check the installation.'],
  E_XLSX_GENERATE:['本机 Excel 生成失败，请先使用 JSON 导出。','Local Excel generation failed. Use JSON export for now.'],
  E_XLSX_TIMEOUT:['Excel 生成超过 60 秒，请重试或使用 JSON。','Excel generation exceeded 60 seconds. Retry or use JSON.'],
  E_XLSX_CANCELLED:['Excel 导出已取消。','Excel export was cancelled.'],
  E_XLSX_UNAVAILABLE:['Excel 导出不可用，请重新启用扩展。','Excel export is unavailable. Re-enable the extension.'],
};
export function exportControls(ctx:WebUiPanelContext,selected:()=>string|null=()=>null) {
  const zh=ctx.language==='zh'||ctx.language==='zh-Hant';
  const prefix=`${zh?'token计数':'Token count'} v${pkg.version} · `;
  const format=ctx.ui.h('label',null,zh?'导出格式':'Export format'),select=ctx.ui.h('select');select.dataset.exportFormat='';select.setAttribute('aria-label',zh?'导出格式':'Export format');
  for(const [value,name] of [['json','JSON'],['xlsx','Excel (.xlsx)']]){const option=ctx.ui.h('option',null,name);option.value=value;select.append(option);}format.append(select);
  const notice=ctx.ui.h('p','cm-muted cm-export-note');notice.hidden=true;notice.setAttribute('role','status');notice.dataset.version=pkg.version;
  const button=ctx.ui.button(zh?'导出全部统计':'Export all statistics',{onClick:()=>{void save();}});button.dataset.action='export';
  let owner:string|null=null;
  async function save(){
    if(button.disabled||ctx.signal.aborted)return;
    button.disabled=true;select.disabled=true;delete notice.dataset.errorCode;
    const extension=select.value==='xlsx'?'xlsx':'json';
    let stage:ExportCode=extension==='xlsx'?'E_EXPORT_TRANSPORT':'E_EXPORT_DATA';
    notice.hidden=false;notice.textContent=extension==='xlsx'?(zh?'正在本机生成 Excel…':'Generating Excel locally…'):(zh?'正在取得统计…':'Preparing statistics…');
    try{
      const id=selected(),document=ctx.root.ownerDocument,view=document.defaultView!;
      let blob:Blob,at=new Date().toISOString();
      if(extension==='xlsx'){
        if(typeof ctx.invokeBinary!=='function'||typeof ctx.notifyOnUnmount!=='function')throw new Error('E_EXPORT_INTERFACE');
        if(!owner){owner=view.crypto.randomUUID();ctx.notifyOnUnmount('export.cancel',[owner]);}
        blob=await ctx.invokeBinary('export.xlsx',[id,ctx.language,owner]);
        if(ctx.signal.aborted)return;
        if(blob.type.split(';')[0]!==XLSX_MIME||blob.size<4)throw new Error('E_EXPORT_TRANSPORT');
        const header=new Uint8Array(await blob.slice(0,4).arrayBuffer());
        if(header[0]!==80||header[1]!==75)throw new Error('E_EXPORT_TRANSPORT');
      }else{
        const report=await ctx.invoke<StatisticsExport>('export',id?[id]:[]);if(ctx.signal.aborted)return;
        stage='E_EXPORT_DOWNLOAD';at=report.exportedAt;blob=new view.Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json;charset=utf-8'});
      }
      if(ctx.signal.aborted)return;stage='E_EXPORT_DOWNLOAD';
      const url=view.URL.createObjectURL(blob);let disposed=false;
      const resource={dispose(){if(!disposed){disposed=true;view.URL.revokeObjectURL(url);}}};
      ctx.own(resource);ctx.timeout(()=>resource.dispose(),60000);
      const anchor=document.createElement('a');anchor.href=url;anchor.download=`token-count-${at.replace(/[^0-9TZ]/g,'-')}.${extension}`;
      anchor.hidden=true;ctx.root.append(anchor);try{anchor.click();}finally{anchor.remove();}
      notice.textContent=zh?'已生成导出文件。':'Export file generated.';
    }catch(error){
      if(!ctx.signal.aborted){const code=exportCode(error,stage);notice.dataset.errorCode=code;
        notice.textContent=`${prefix}${errors[code][zh?0:1]} [${code}] ${zh?'未自动上传任何数据。':'No data was uploaded.'}`;}
    }finally{if(!ctx.signal.aborted){button.disabled=false;select.disabled=false;}}
  }
  return {button,notice,format};
}
