import type {RuntimeReport} from './runtime/types.ts';
import type {ScanReport} from './types.ts';
import {createExport,type StatisticsExport} from './export.ts';
type Check=(v:unknown)=>boolean;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(limit=180):Check=>v=>typeof v==='string'&&v.length<=limit&&!/[\x00-\x1f]/.test(v);
const token:Check=v=>typeof v==='string'&&/^[A-Za-z0-9_.:@+-]{1,180}$/.test(v);
const number:Check=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const integer:Check=v=>number(v)&&Number.isSafeInteger(v);
const nullable=(check:Check):Check=>v=>v===null||check(v);
const bool:Check=v=>typeof v==='boolean';
const date:Check=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const one=(...choices:unknown[]):Check=>v=>choices.includes(v);
const array=(check:Check,max=10000):Check=>v=>Array.isArray(v)&&v.length<=max&&v.every(check);
const shape=(fields:Record<string,Check>):Check=>v=>obj(v)&&Object.entries(fields).every(([k,check])=>check(v[k]));
const meterFields={input:nullable(integer),output:nullable(integer),cachedInput:nullable(integer),uncachedInput:nullable(integer),reasoning:nullable(integer)};
const issueNames=['missing_source','unreadable_source','unsafe_path','source_changed','oversized_record','invalid_record','unmatched_result','missing_meter','conflicting_record','retention_limit','worker_failed','stop_incomplete'];
const staticIssues=['manifest_unreadable','invalid_manifest','missing_description','description_unreadable','unsafe_path','oversized_file','invalid_tools','invalid_tool','duplicate_tool','conflicting_tool','invalid_prompts','invalid_prompt','duplicate_prompt','conflicting_prompt'];
const issueMap:Check=v=>obj(v)&&Object.entries(v).every(([k,n])=>issueNames.includes(k)&&integer(n));
const request=shape({...meterFields,id:token,run:token,round:nullable(integer),responseId:nullable(token),role:token,model:token,
  at:date,startedAt:nullable(date),durationMs:nullable(integer),outcome:token,basis:one('provider','reported'),boundary:bool,tools:array(token)});
const tool=shape({id:token,run:token,round:nullable(integer),responseId:nullable(token),callId:nullable(token),at:date,startedAt:nullable(date),
  tool:token,owner:token,role:token,durationMs:nullable(integer),failed:nullable(bool),boundary:bool,textTokens:nullable(integer),
  textBasis:one('transcript','complete_receipt',null),imageCount:nullable(integer),imageTokens:one(null),flashImageUpperBound:nullable(integer)});
const group=shape({owner:token,calls:integer,perMinute:nullable(number),durationMs:nullable(integer),failures:nullable(integer),
  textTokens:nullable(integer),measuredTexts:integer,unknownTexts:integer,imageCount:nullable(integer)});
const source=one('ready','missing','unreadable','changed','unavailable');
const runtime=shape({state:one('off','starting','recording','stopped','error'),profile:one('v41','v4'),startedAt:nullable(date),endedAt:nullable(date),updatedAt:nullable(date),
  durationMs:integer,run:nullable(token),sources:shape({usage:source,index:source,tools:source,transcript:source}),issues:issueMap,
  requests:array(request),tools:array(tool),groups:array(group),truncated:bool,
  totals:shape({...meterFields,providerRequests:integer,reportedRecords:integer,boundaryRequests:integer,toolCalls:integer,boundaryTools:integer})});
const scan=nullable(shape({profile:one('v41','v4'),estimatedAt:date,directoryStatus:one('ok','missing','unreadable'),measuredTokens:integer,
  completeCount:integer,partialCount:integer,unavailableCount:integer,rows:array(shape({name:str(214),kind:one('world','provider','bot','unknown'),
    status:one('complete','partial','unavailable','not_applicable'),toolCount:nullable(integer),toolTokens:nullable(integer),promptTokens:nullable(integer),
    totalTokens:nullable(integer),share:nullable(v=>number(v)&&(v as number)<=1),issues:array(one(...staticIssues),30)}))}));
/** Rebuild through the same export allowlist after validating stored counts and bounded structures. */
export function validateSnapshot(v:unknown):StatisticsExport {
  if(!obj(v)||v.schemaVersion!==1||!runtime(v.runtime)||!scan(v.static))throw new Error('Invalid history snapshot.');
  const clean=createExport(v.static as ScanReport|null,v.runtime as RuntimeReport);
  if(obj(v.extension)&&typeof v.extension.version==='string'&&/^\d+\.\d+\.\d+$/.test(v.extension.version))clean.extension.version=v.extension.version;
  return clean;
}
