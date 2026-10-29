import type { Profile } from '../types.ts';
export type RuntimeState='off'|'starting'|'recording'|'stopped'|'error';
export type SourceState='ready'|'missing'|'unreadable'|'changed'|'unavailable';
export type RuntimeIssue='missing_source'|'unreadable_source'|'unsafe_path'|'source_changed'|'oversized_record'
  |'invalid_record'|'unmatched_result'|'missing_meter'|'conflicting_record'|'retention_limit'|'worker_failed'|'stop_incomplete';
export interface Meters {
  input:number|null; output:number|null; cachedInput:number|null; uncachedInput:number|null; reasoning:number|null;
}
export interface RuntimeRequest extends Meters {
  id:string; run:string; round:number|null; responseId:string|null; role:string; model:string;
  at:string; startedAt:string|null; durationMs:number|null; outcome:string;
  basis:'provider'|'reported'; boundary:boolean; tools:string[];
}
export interface RuntimeTool {
  id:string; run:string; round:number|null; responseId:string|null; callId:string|null;
  at:string; startedAt:string|null; tool:string; owner:string; role:string; durationMs:number|null; failed:boolean|null;
  boundary:boolean; textTokens:number|null; textBasis:'transcript'|'complete_receipt'|null;
  imageCount:number|null; imageTokens:null; flashImageUpperBound:number|null;
}
export interface RuntimeGroup {
  owner:string; calls:number; perMinute:number|null; durationMs:number|null; failures:number|null;
  textTokens:number|null; measuredTexts:number; unknownTexts:number; imageCount:number|null;
}
export interface RuntimeReport {
  historySaveFailed?:boolean;
  state:RuntimeState; profile:Profile; startedAt:string|null; endedAt:string|null; updatedAt:string|null;
  durationMs:number; run:string|null;
  sources:Record<'usage'|'index'|'tools'|'transcript',SourceState>;
  issues:Partial<Record<RuntimeIssue,number>>;
  requests:RuntimeRequest[]; tools:RuntimeTool[]; groups:RuntimeGroup[];
  totals:Meters & {providerRequests:number; reportedRecords:number; boundaryRequests:number; toolCalls:number; boundaryTools:number};
  truncated:boolean;
}
export function emptyRuntime(profile:Profile='v41'):RuntimeReport {
  return {state:'off',profile,startedAt:null,endedAt:null,updatedAt:null,durationMs:0,run:null,
    sources:{usage:'unavailable',index:'unavailable',tools:'unavailable',transcript:'unavailable'},issues:{},
    requests:[],tools:[],groups:[],truncated:false,
    totals:{input:null,output:null,cachedInput:null,uncachedInput:null,reasoning:null,
      providerRequests:0,reportedRecords:0,boundaryRequests:0,toolCalls:0,boundaryTools:0}};
}
