import {emptyRuntime,type RuntimeRequest,type RuntimeTool,type RuntimeReport} from '../../src/runtime/types.ts';
export function request(id='request-a',tools:string[]=[],extra:Partial<RuntimeRequest>={}):RuntimeRequest {
  return {id,run:'demo-run',round:1,responseId:`response-${id}`,role:'main',model:'deepseek-flash',
    at:'2026-10-29T04:00:01.000Z',startedAt:'2026-10-29T04:00:00.000Z',durationMs:1000,outcome:'completed',basis:'provider',boundary:false,
    input:100,output:20,cachedInput:70,uncachedInput:30,reasoning:5,tools,...extra};
}
export function tool(id='tool-a',requestId='request-a',extra:Partial<RuntimeTool>={}):RuntimeTool {
  return {id,run:'demo-run',round:1,responseId:`response-${requestId}`,callId:`call-${id}`,role:'main',tool:'socialmedia_search',owner:'socialmedia',
    at:'2026-10-29T04:00:02.000Z',startedAt:'2026-10-29T04:00:01.000Z',durationMs:1000,failed:false,boundary:false,
    textTokens:250,textBasis:'transcript',imageCount:0,imageTokens:null,flashImageUpperBound:0,...extra};
}
/** Public synthetic metadata only; reused by DOM tests and browser previews. */
export function demoReport(count=16):RuntimeReport {
  const report=emptyRuntime();report.state='stopped';report.startedAt='2026-10-29T04:00:00.000Z';report.endedAt='2026-10-29T04:12:00.000Z';
  report.updatedAt=report.endedAt;report.durationMs=720000;report.run='demo-run';report.sources={usage:'ready',index:'ready',tools:'ready',transcript:'ready'};
  const names=['socialmedia_search','socialmedia_video','socialmedia_watch','pet_say','append_file','end_turn','terrarium_inspect'];
  for(let i=0;i<count;i++){
    const key=(i+1).toString(16).padStart(8,'0')+'abcdef0123456789';
    const name=names[i%names.length],owner=i%names.length<3?'socialmedia':i%names.length===3?'desktop-pet':i%names.length===6?'terrarium':'persona-core';
    const at=new Date(Date.parse(report.startedAt)+(i+1)*10000).toISOString();
    const input=96000+i*211,output=23+i%5*47,uncached=120+i*13;
    const ids=[`tool-${key}`];
    report.tools.push(tool(ids[0],key,{tool:name,owner,at:new Date(Date.parse(at)+500).toISOString(),durationMs:500+i*73,textTokens:34+i*117,
      imageCount:i%names.length===2?3:0,flashImageUpperBound:i%names.length===2?3072:0}));
    if(i===2){ids.push('second-tool');report.tools.push(tool('second-tool',key,{tool:'video_frame_extract',at:new Date(Date.parse(at)+1000).toISOString(),textTokens:40,imageCount:2,flashImageUpperBound:2048}));}
    report.requests.push(request(key,ids,{at,input,output,cachedInput:input-uncached,uncachedInput:uncached,reasoning:i%5===0?0:Math.min(output,30)}));
  }
  report.totals.providerRequests=report.requests.length;report.totals.toolCalls=report.tools.length;
  for(const field of ['input','output','cachedInput','uncachedInput','reasoning'] as const)report.totals[field]=report.requests.reduce((n,r)=>n+(r[field]??0),0);
  const owners=[...new Set(report.tools.map(t=>t.owner))];
  report.groups=owners.map(owner=>{const tools=report.tools.filter(t=>t.owner===owner);return {owner,calls:tools.length,perMinute:tools.length/12,durationMs:tools.reduce((n,t)=>n+(t.durationMs??0),0),
    failures:0,textTokens:tools.reduce((n,t)=>n+(t.textTokens??0),0),measuredTexts:tools.length,unknownTexts:0,imageCount:tools.reduce((n,t)=>n+(t.imageCount??0),0)};});
  return report;
}
