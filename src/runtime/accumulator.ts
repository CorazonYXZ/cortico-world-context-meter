import {createHash} from 'node:crypto';
import {object,type CountTokens} from '../estimate.ts';
import type {Profile} from '../types.ts';
import {RUN_ID} from './tail.ts';
import {emptyRuntime,type Meters,type RuntimeGroup,type RuntimeIssue,type RuntimeReport,type RuntimeRequest,type RuntimeTool} from './types.ts';
const LIMIT=10000;
const digest=(...values:unknown[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0,24);
const name=(value:unknown,fallback='unknown')=>typeof value==='string'&&/^[a-zA-Z0-9_.@+-]{1,120}$/.test(value)?value:fallback;
const id=(value:unknown):string|null=>typeof value==='string'&&value.length>0&&value.length<=512?digest(value):null;
export const meter=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const date=(value:unknown):string|null=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const sum=(values:(number|null)[])=>{
  if(!values.some(v=>v!==null))return null;
  const n=values.reduce<number>((s,v)=>s+(v??0),0);return Number.isSafeInteger(n)?n:null;
};
const offsetDate=(at:string,offset:number):string|null=>{
  const date=new Date(Date.parse(at)+offset);return Number.isFinite(date.getTime())?date.toISOString():null;
};
interface TextSummary {textTokens:number|null;imageCount:number|null;}
export class Accumulator {
  readonly report:RuntimeReport;
  private readonly requests=new Map<string,RuntimeRequest>();
  private readonly tools=new Map<string,RuntimeTool>();
  private readonly results=new Map<string,TextSummary>();
  private readonly seenResults=new Set<string>();
  private readonly boundaries=new Set<string>();
  constructor(profile:Profile,readonly startMs:number,private readonly count:CountTokens,run:string|null){
    this.report=emptyRuntime(profile);this.report.startedAt=new Date(startMs).toISOString();this.report.state='recording';this.report.run=run;
  }
  note=(issue:RuntimeIssue)=>{this.report.issues[issue]=(this.report.issues[issue]??0)+1;};
  private capacity(map:{size:number},keyExists=false):boolean {
    if(keyExists||map.size<LIMIT)return true;
    this.report.truncated=true;if(!this.report.issues.retention_limit)this.note('retention_limit');return false;
  }
  private validRun(value:unknown):value is string {return typeof value==='string'&&RUN_ID.test(value)&&(!this.report.run||value===this.report.run);}
  usage(value:unknown):void {
    if(!object(value)||value.version!==2||!this.validRun(value.run)){this.note('invalid_record');return;}
    const at=date(value.ts);const attempt=object(value.attempt)?value.attempt:null;
    const key=id(attempt?.id??value.recordId);
    if(!key||!at){this.note('invalid_record');return;}
    if(this.requests.has(key))return;
    if(!this.capacity(this.requests))return;
    const m=attempt&&object(attempt.meters)?attempt.meters:null;
    // Flat legacy counters replace absent upstream meters with zero; never use that fallback for an attempt.
    const meters:Meters=m?{input:meter(m.input),output:meter(m.output),cachedInput:meter(m.cachedInput),uncachedInput:meter(m.uncachedInput),reasoning:meter(m.reasoning)}:
      attempt?{input:null,output:null,cachedInput:null,uncachedInput:null,reasoning:null}:
      {input:meter(value.promptTokens),output:meter(value.completionTokens),cachedInput:meter(value.cacheHitTokens),uncachedInput:meter(value.cacheMissTokens),reasoning:meter(value.reasoningTokens)};
    if(Object.values(meters).some(v=>v===null))this.note('missing_meter');
    if(meters.input!==null&&((meters.cachedInput??0)>meters.input||(meters.uncachedInput??0)>meters.input ||
      (meters.cachedInput!==null&&meters.uncachedInput!==null&&meters.cachedInput+meters.uncachedInput!==meters.input))){
      meters.cachedInput=null;meters.uncachedInput=null;this.note('invalid_record');
    }
    if(meters.output!==null&&meters.reasoning!==null&&meters.reasoning>meters.output){meters.reasoning=null;this.note('invalid_record');}
    const startedAt=date(attempt?.startedAt);const durationMs=meter(attempt?.elapsedMs);
    const finished=startedAt!==null&&durationMs!==null?offsetDate(startedAt,durationMs):at;
    if(finished===null){this.note('invalid_record');return;}
    if(Date.parse(finished)<this.startMs)return;
    const request:RuntimeRequest={...meters,id:key,run:value.run,round:meter(value.round),responseId:id(attempt?.responseId),
      role:name(value.role),model:name(value.model),at:finished,startedAt,durationMs,
      outcome:typeof attempt?.outcome==='string'&&['completed','incomplete','failed','aborted','discarded'].includes(attempt.outcome)?attempt.outcome:
        !attempt?'reported':'unknown',basis:attempt?'provider':'reported',
      // Reports without a request start cannot prove that their entire usage belongs to the window.
      boundary:startedAt===null||durationMs===null||Date.parse(startedAt)<this.startMs,tools:[]};
    this.requests.set(key,request);
  }
  tool(value:unknown):void {
    if(!object(value)||!this.validRun(value.run)){this.note('invalid_record');return;}
    const at=date(value.ts);const durationMs=meter(value.durMs);
    if(!at||typeof value.tool!=='string'){this.note('invalid_record');return;}
    if(Date.parse(at)<this.startMs)return;
    const callId=id(value.call),seq=meter(value.seq);
    if(callId===null&&seq===null){this.note('invalid_record');return;}
    const key=digest(value.run,callId??`seq:${seq}`);
    const existing=this.tools.get(key);
    if(existing){
      if(existing.tool!==name(value.tool)||existing.owner!==name(value.mod,'persona-core')||existing.durationMs!==durationMs)this.note('conflicting_record');
      return;
    }
    if(!this.capacity(this.tools))return;
    const startedAt=durationMs!==null?offsetDate(at,-durationMs):null;
    const resultKey=callId?digest(value.run,callId):null;
    const paired=resultKey?this.results.get(resultKey):undefined;
    if(resultKey&&paired)this.results.delete(resultKey);
    let textTokens:number|null=null;
    let textBasis:RuntimeTool['textBasis']=null;
    if(paired){textTokens=paired.textTokens;textBasis='transcript';}
    else if(typeof value.receipt==='string'&&meter(value.chars)===value.receipt.length){
      textTokens=this.count(value.receipt);textBasis='complete_receipt';
    }
    const imageCount=paired?.imageCount??(value.blobs===undefined||value.blobs===0?0:null);
    this.tools.set(key,{id:key,run:value.run,round:meter(value.round),responseId:id(value.resp),callId,at,startedAt,
      tool:name(value.tool),owner:name(value.mod,'persona-core'),role:name(value.role),durationMs,
      failed:value.failed===undefined?false:value.failed===true?true:null,boundary:startedAt===null||Date.parse(startedAt)<this.startMs,
      textTokens,textBasis,imageCount,imageTokens:null,flashImageUpperBound:this.upper(imageCount)});
  }
  transcript(value:unknown):void {
    if(!object(value)||!this.validRun(value.run)){this.note('invalid_record');return;}
    if(value.kind==='boundary'){
      if(typeof value.event==='string'&&['handoff','clear','prefix-reload','ephemeral-drop','orphan-result-drop'].includes(value.event)){
        const key=digest(value.run,value.ts,value.event);if(this.capacity(this.boundaries,this.boundaries.has(key)))this.boundaries.add(key);
      }return;
    }
    if(value.kind!=='item'||!object(value.item)){this.note('invalid_record');return;}
    // Chats, reasoning, instructions and tool arguments are not selected, retained or interpreted.
    const item=value.item;if(item.type!=='function_call_output')return;
    const at=date(value.ts),callId=id(item.call_id);
    if(!at||!callId){this.note('invalid_record');return;}
    if(Date.parse(at)<this.startMs)return;
    const key=digest(value.run,callId);
    if(this.seenResults.has(key))return;
    if(!this.capacity(this.seenResults))return;
    this.seenResults.add(key);
    let textTokens:number|null=null;
    let explicitImages=0;
    if(typeof item.output==='string')textTokens=this.count(item.output);
    else if(Array.isArray(item.output)){
      const texts:string[]=[];let valid=true;
      for(const part of item.output){
        if(!object(part)){valid=false;continue;}
        if(['input_text','output_text','text'].includes(String(part.type))&&typeof part.text==='string')texts.push(part.text);
        else if(part.type==='input_image')explicitImages++;
        else valid=false;
      }
      if(valid)textTokens=this.count(texts.join(''));else this.note('invalid_record');
    }else this.note('invalid_record');
    let imageCount:number|null=object(value.context)?explicitImages:null;
    const blobs=object(value.context)?value.context.blobs:undefined;
    if(Array.isArray(blobs)){
      if(blobs.every(b=>object(b)&&typeof b.mime==='string')&&imageCount!==null)imageCount+=blobs.filter(b=>(b as {mime:string}).mime.startsWith('image/')).length;
      else imageCount=null;
    }else if(blobs!==undefined)imageCount=null;
    const summary={textTokens,imageCount};
    const tool=this.tools.get(key);
    if(tool){tool.textTokens=textTokens;tool.textBasis='transcript';tool.imageCount=imageCount;tool.flashImageUpperBound=this.upper(imageCount);}
    else if(this.capacity(this.results))this.results.set(key,summary);
  }
  private upper(images:number|null){return this.report.profile==='v41'&&images!==null?images*1024:null;}
  snapshot(now=Date.now(),stopped=false):RuntimeReport {
    this.report.durationMs=Math.max(0,now-this.startMs);this.report.updatedAt=new Date(now).toISOString();
    if(stopped){this.report.state='stopped';this.report.endedAt=this.report.updatedAt;}
    const tools=[...this.tools.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
    const requests=[...this.requests.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
    const responseTools=new Map<string,string[]>(),roundTools=new Map<string,string[]>(),roundWithoutResponse=new Map<string,string[]>();
    const add=(map:Map<string,string[]>,key:string,value:string)=>{const list=map.get(key)??[];list.push(value);map.set(key,list);};
    for(const tool of tools){
      if(tool.responseId!==null)add(responseTools,JSON.stringify([tool.run,tool.role,tool.responseId]),tool.id);
      if(tool.round!==null){
        const key=JSON.stringify([tool.run,tool.role,tool.round]);add(roundTools,key,tool.id);
        if(tool.responseId===null)add(roundWithoutResponse,key,tool.id);
      }
    }
    for(const request of requests){
      const roundKey=JSON.stringify([request.run,request.role,request.round]);
      request.tools=request.responseId!==null?[...(responseTools.get(JSON.stringify([request.run,request.role,request.responseId]))??[]),
        ...(request.round===null?[]:roundWithoutResponse.get(roundKey)??[])]:request.round===null?[]:roundTools.get(roundKey)??[];
    }
    const inside=requests.filter(r=>!r.boundary&&r.basis==='provider');
    const insideTools=tools.filter(t=>!t.boundary);
    this.report.requests=requests;this.report.tools=tools;
    const grouped=new Map<string,RuntimeTool[]>();for(const tool of insideTools){const list=grouped.get(tool.owner)??[];list.push(tool);grouped.set(tool.owner,list);}
    this.report.groups=[...grouped].map(([owner,list]):RuntimeGroup=>({owner,calls:list.length,
      perMinute:this.report.durationMs>0?list.length*60000/this.report.durationMs:null,
      durationMs:sum(list.map(t=>t.durationMs)),failures:list.some(t=>t.failed===null)?null:list.filter(t=>t.failed).length,
      textTokens:sum(list.map(t=>t.textTokens)),measuredTexts:list.filter(t=>t.textTokens!==null).length,
      unknownTexts:list.filter(t=>t.textTokens===null).length,imageCount:list.some(t=>t.imageCount===null)?null:sum(list.map(t=>t.imageCount))
    })).sort((a,b)=>(b.textTokens??-1)-(a.textTokens??-1)||b.calls-a.calls||a.owner.localeCompare(b.owner));
    for(const field of ['input','output','cachedInput','uncachedInput','reasoning'] as const)this.report.totals[field]=sum(inside.map(r=>r[field]));
    Object.assign(this.report.totals,{providerRequests:inside.length,reportedRecords:requests.filter(r=>r.basis==='reported').length,
      boundaryRequests:requests.filter(r=>r.boundary&&r.basis==='provider').length,toolCalls:insideTools.length,boundaryTools:tools.length-insideTools.length});
    const unmatched=tools.filter(t=>t.textTokens===null).length+this.results.size;
    if(unmatched)this.report.issues.unmatched_result=unmatched;else delete this.report.issues.unmatched_result;
    return structuredClone(this.report);
  }
}
