import ExcelJS from 'exceljs';
import type {StatisticsExport} from '../export.ts';
type Cell=string|number|boolean|null;
const labels:Record<string,string>={id:'标识',run:'运行标识',round:'轮次',responseId:'响应标识',callId:'调用标识',role:'角色／来源',model:'模型',
  at:'完成时间（ISO）',startedAt:'开始时间（ISO）',durationMs:'耗时 ms',outcome:'状态',basis:'回执类型',boundary:'跨边界／起点未知',
  input:'输入',output:'输出',cachedInput:'缓存输入',uncachedInput:'未缓存输入',reasoning:'推理输出',totalTokens:'总 token（输入＋输出）',
  tool:'工具',owner:'World 来源',failed:'记录失败',textTokens:'文本估算 token',textBasis:'文本依据',imageCount:'图片附件',imageTokens:'实际图片 token',flashImageUpperBound:'Flash 条件上限',
  name:'包名',kind:'类别',status:'完整性',toolCount:'工具数',toolTokens:'工具声明 token',promptTokens:'模板 token',share:'已统计占比',issues:'覆盖提示',
  calls:'次数',perMinute:'每分钟次数',failures:'失败次数',measuredTexts:'已计文本',unknownTexts:'未知文本',
  requestId:'请求标识',toolId:'工具记录标识',linked:'工具记录已留存',key:'项目',value:'值'};
export async function xlsxBuffer(data:StatisticsExport,language='zh'):Promise<ArrayBuffer>{
  const zh=language.startsWith('zh'),workbook=new ExcelJS.Workbook();workbook.creator='token计数';workbook.created=new Date(data.exportedAt);
  function sheet(name:string,en:string,keys:string[],rows:Record<string,Cell>[]){
    const ws=workbook.addWorksheet(zh?name:en,{views:[{state:'frozen',ySplit:1}]});
    ws.columns=keys.map(key=>({header:zh?labels[key]??key:key,key,width:key==='key'?35:key==='value'?80:/Id$|^id$|^at$|At$/.test(key)?30:20}));
    for(const row of rows)ws.addRow(keys.map(key=>row[key]??null));
    ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(ws.rowCount,1),column:keys.length}};
    ws.eachRow((row,n)=>{row.font={name:'Calibri',size:11,color:{argb:'FF2D4639'},bold:n===1};
      row.fill={type:'pattern',pattern:'solid',fgColor:{argb:n===1?'FFE1E1D1':n%2?'FFF5F5F0':'FFEEEFE6'}};
      row.alignment={vertical:'top',wrapText:true};row.eachCell(cell=>{if(typeof cell.value==='number')cell.numFmt='0.########';});});
    ws.getRow(1).height=30;return ws;
  }
  const overview:Record<string,Cell>[]=[];
  const add=(key:string,value:Cell)=>overview.push({key,value});
  add(zh?'说明':'Notes',zh?'空白表示未知。总 token = 输入＋输出；缓存、推理和工具文本不重复累加。只导出选中窗口，不合并多次观察。':'Blank means unknown. Total = input + output. Cache, reasoning and tool estimates are not added again. One selected observation only.');
  add('schemaVersion',data.schemaVersion);for(const [key,value] of Object.entries(data.extension))add(`extension.${key}`,value);
  add('exportedAt',data.exportedAt);for(const [key,value] of Object.entries(data.selection))add(`selection.${key}`,value);
  const runtime=data.runtime;
  for(const key of ['state','profile','startedAt','endedAt','updatedAt','durationMs','run','truncated'] as const)add(`runtime.${key}`,runtime[key]);
  for(const [key,value] of Object.entries(runtime.totals))add(`totals.${key}`,value);
  for(const [key,value] of Object.entries(runtime.sources))add(`sources.${key}`,value);
  for(const [key,value] of Object.entries(runtime.issues))add(`issues.${key}`,value??null);
  for(const [key,value] of Object.entries(runtime.meterCoverage)){add(`meterCoverage.${key}.known`,value.known);add(`meterCoverage.${key}.unknown`,value.unknown);}
  for(const [key,value] of Object.entries(data.limits))add(`limits.${key}`,value);
  if(data.static)for(const key of ['profile','estimatedAt','directoryStatus','measuredTokens','completeCount','partialCount','unavailableCount'] as const)add(`static.${key}`,data.static[key]);
  else add('static',null);
  data.notes.forEach((note,i)=>add(`note.${i+1}`,note));sheet('概览','Overview',['key','value'],overview);
  const requestKeys=['id','run','round','responseId','role','model','at','startedAt','durationMs','outcome','basis','boundary','input','output','cachedInput','uncachedInput','reasoning','totalTokens'];
  sheet('模型请求','Requests',requestKeys,runtime.requests.map(r=>Object.fromEntries(requestKeys.map(k=>[k,r[k as keyof typeof r]])) as Record<string,Cell>));
  const toolKeys=['id','run','round','responseId','callId','at','startedAt','tool','owner','role','durationMs','failed','boundary','textTokens','textBasis','imageCount','imageTokens','flashImageUpperBound'];
  sheet('工具明细','Tools',toolKeys,runtime.tools.map(t=>Object.fromEntries(toolKeys.map(k=>[k,t[k as keyof typeof t]])) as Record<string,Cell>));
  const ids=new Set(runtime.tools.map(t=>t.id));
  sheet('请求工具关联','Request tool links',['requestId','toolId','linked'],runtime.requests.flatMap(r=>r.tools.map(id=>({requestId:r.id,toolId:id,linked:ids.has(id)}))));
  sheet('World 汇总','World summary',['owner','calls','perMinute','durationMs','failures','textTokens','measuredTexts','unknownTexts','imageCount'],runtime.groups);
  sheet('静态排行','Static ranking',['name','kind','status','toolCount','toolTokens','promptTokens','totalTokens','share','issues'],
    data.static?.rows.map(r=>({...r,issues:r.issues.join('; ')}))??[]);
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
}
