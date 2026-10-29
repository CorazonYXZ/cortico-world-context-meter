import type {RuntimeReport,RuntimeRequest,RuntimeTool} from '../runtime/types.ts';

export interface MergedRow {
  key:string;
  at:string;
  request:RuntimeRequest|null;
  tools:RuntimeTool[];
  link:'matched'|'none'|'unmatched'|'ambiguous';
  pendingLinks:number;
  candidateRequests:string[];
  totalTokens:number|null;
}

/** Subset counters and tool text never participate in request totals. */
export function requestTotal(request:Pick<RuntimeRequest,'input'|'output'>):number|null {
  const {input,output}=request;
  if(input===null||output===null||!Number.isSafeInteger(input)||!Number.isSafeInteger(output)||input<0||output<0)return null;
  const total=input+output;
  return Number.isSafeInteger(total)?total:null;
}

/** Join the entire retained report before choosing visible rows. No timestamps or short IDs are join keys. */
export function mergedRows(report:Pick<RuntimeReport,'requests'|'tools'>):MergedRow[] {
  const tools=new Map(report.tools.map(tool=>[tool.id,tool]));
  const requests=new Map(report.requests.map(request=>[request.id,request]));
  const owners=new Map<string,Set<string>>();
  for(const request of requests.values()){
    for(const id of new Set(request.tools)){
      const tool=tools.get(id);
      if(!tool||tool.run!==request.run||tool.role!==request.role ||
        (tool.responseId!==null&&request.responseId!==null&&tool.responseId!==request.responseId))continue;
      const links=owners.get(id)??new Set<string>();links.add(request.id);owners.set(id,links);
    }
  }
  const rows:MergedRow[]=[];
  for(const request of requests.values()){
    const matched:RuntimeTool[]=[];let pendingLinks=0;
    for(const id of new Set(request.tools)){
      const tool=tools.get(id),links=owners.get(id);
      if(tool&&links?.size===1&&links.has(request.id))matched.push(tool);
      else pendingLinks++;
    }
    matched.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
    rows.push({key:`request:${request.id}`,at:request.at,request,tools:matched,
      link:pendingLinks?'ambiguous':matched.length?'matched':'none',pendingLinks,candidateRequests:[],totalTokens:requestTotal(request)});
  }
  for(const tool of tools.values()){
    const links=owners.get(tool.id);
    if(links?.size===1)continue;
    rows.push({key:`tool:${tool.id}`,at:tool.at,request:null,tools:[tool],link:links&&links.size>1?'ambiguous':'unmatched',
      pendingLinks:0,candidateRequests:[...(links??[])],totalTokens:null});
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at)||a.key.localeCompare(b.key));
}
