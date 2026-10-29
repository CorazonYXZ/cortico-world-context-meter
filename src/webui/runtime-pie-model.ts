import type {RuntimeReport} from '../runtime/types.ts';
import {mergedRows} from './runtime-view.ts';

export type PieKind='tool'|'shared'|'none'|'incomplete'|'other';
export interface PieCategory {
  key:string;kind:PieKind;tool:string;owner:string;tokens:number;requests:number;
}
export interface PieSlice extends PieCategory {members:PieCategory[]}
export interface PieSummary {
  state:'empty'|'unknown'|'zero'|'ready'|'overflow';
  eligible:number;known:number;unknown:number;total:number|null;
  categories:PieCategory[];slices:PieSlice[];
}
export const pieColors=['#2D4639','#4C6D5E','#9BB69A','#E1E1D1','#F5F5F0','#F1F8E9','#DCEDC8','#C5E1A5','#A5D6A7','#81C784'] as const;

/** One complete provider request belongs to one category, irrespective of tool call count. */
export function pieSummary(report:Pick<RuntimeReport,'requests'|'tools'>):PieSummary {
  const buckets=new Map<string,{kind:PieKind;tool:string;owner:string;tokens:bigint;requests:number}>();
  let eligible=0,known=0,unknown=0,total=0n;
  for(const row of mergedRows(report)){
    if(!row.request||row.request.basis!=='provider'||row.request.boundary)continue;
    eligible++;
    if(row.totalTokens===null){unknown++;continue;}
    known++;
    const types=new Map(row.tools.map(t=>[JSON.stringify(['tool',t.owner,t.tool]),t]));
    let key:string,kind:PieKind,tool='',owner='';
    if(row.pendingLinks||row.link==='ambiguous'){key='special:incomplete';kind='incomplete';}
    else if(types.size>1){key='special:shared';kind='shared';}
    else if(types.size===0){key='special:none';kind='none';}
    else {const entry=types.entries().next().value!;key=entry[0];kind='tool';tool=entry[1].tool;owner=entry[1].owner;}
    const bucket=buckets.get(key)??{kind,tool,owner,tokens:0n,requests:0};
    bucket.tokens+=BigInt(row.totalTokens);bucket.requests++;buckets.set(key,bucket);total+=BigInt(row.totalTokens);
  }
  if(total>BigInt(Number.MAX_SAFE_INTEGER))return {state:'overflow',eligible,known,unknown,total:null,categories:[],slices:[]};
  const categories:PieCategory[]=[...buckets].map(([key,b])=>({...b,key,tokens:Number(b.tokens)}));
  categories.sort((a,b)=>b.tokens-a.tokens||(a.key<b.key?-1:a.key>b.key?1:0));
  const slices:PieSlice[]=categories.length<=10?categories.map(c=>({...c,members:[]})):[
    ...categories.slice(0,9).map(c=>({...c,members:[]})),
    {key:'special:other',kind:'other',tool:'',owner:'',tokens:categories.slice(9).reduce((sum,c)=>sum+c.tokens,0),
      requests:categories.slice(9).reduce((sum,c)=>sum+c.requests,0),members:categories.slice(9)},
  ];
  return {state:!eligible?'empty':!known?'unknown':total===0n?'zero':'ready',eligible,known,unknown,total:Number(total),categories,slices};
}

export function piePercent(tokens:number,total:number,language:string):string {
  if(total<=0)return '—';
  const percent=tokens/total*100;
  return percent>0&&percent<0.1?'＜0.1%':`${percent.toLocaleString(language.startsWith('zh')?'zh-CN':'en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
}

/** Two arcs per edge also handle a single 360-degree slice without SVG's coincident-endpoint ambiguity. */
export function ringPath(start:number,end:number):string {
  const point=(radius:number,angle:number)=>`${180+radius*Math.cos(angle)},${180+radius*Math.sin(angle)}`;
  const mid=(start+end)/2,R=152,r=112;
  return `M ${point(R,start)} A ${R},${R} 0 0 1 ${point(R,mid)} A ${R},${R} 0 0 1 ${point(R,end)} L ${point(r,end)} A ${r},${r} 0 0 0 ${point(r,mid)} A ${r},${r} 0 0 0 ${point(r,start)} Z`;
}
