import type {MergedRow} from './runtime-view.ts';
import type {RuntimeTool} from '../runtime/types.ts';
export const sortColumns=['time','tool','input','output','cached','uncached','reasoning','total','link','owner','role','model','basis',
  'toolTime','duration','failed','text','textBasis','images','imageBound','toolLink'] as const;
export type Column=typeof sortColumns[number];
export interface SortChoice {column:Column;direction:'asc'|'desc';}
export const defaultSort:SortChoice={column:'time',direction:'desc'};
export function isSort(value:unknown):value is SortChoice {
  if(!value||typeof value!=='object')return false;
  const v=value as SortChoice;return sortColumns.includes(v.column)&&(v.direction==='asc'||v.direction==='desc');
}
function toolsSum(row:MergedRow,key:'durationMs'|'textTokens'|'imageCount'|'flashImageUpperBound'):number|null {
  if(!row.tools.length||row.tools.some(t=>t[key]===null))return null;
  const n=row.tools.reduce((n,t)=>n+t[key]!,0);return Number.isSafeInteger(n)?n:null;
}
function names(row:MergedRow,key:keyof RuntimeTool):string|null {
  return row.tools.length?[...new Set(row.tools.map(t=>t[key]).filter(v=>v!==null))].map(String).sort().join(' | ')||null:null;
}
export function sortValue(row:MergedRow,key:Column):string|number|null {
  const r=row.request;
  switch(key){
    case 'time':return Date.parse(row.at);
    case 'tool':return names(row,'tool');case 'owner':return names(row,'owner');
    case 'input':return r?.input??null;case 'output':return r?.output??null;
    case 'cached':return r?.cachedInput??null;case 'uncached':return r?.uncachedInput??null;case 'reasoning':return r?.reasoning??null;
    case 'total':return row.totalTokens;
    case 'role':return r?.role??names(row,'role');case 'model':return r?.model??null;
    case 'basis':return r?`${r.basis} | ${r.outcome}`:null;
    case 'link':return r?`${r.id} | ${r.tools.length} | ${r.boundary}`:null;
    case 'toolLink':return row.tools.length?`${[...(r?[r.id]:row.candidateRequests)].sort().join(' | ')} | ${row.link} | ${row.tools.map(t=>String(t.boundary)).join(' | ')}`:null;
    case 'toolTime':return row.tools.length?Math.max(...row.tools.map(t=>Date.parse(t.at))):null;
    case 'duration':return toolsSum(row,'durationMs');case 'text':return toolsSum(row,'textTokens');
    case 'images':return toolsSum(row,'imageCount');case 'imageBound':return toolsSum(row,'flashImageUpperBound');
    case 'textBasis':return row.tools.some(t=>t.textBasis===null)?null:names(row,'textBasis');
    case 'failed':return row.tools.some(t=>t.failed===true)?1:!row.tools.length||row.tools.some(t=>t.failed===null)?null:0;
  }
}
export function sortRows(rows:MergedRow[],choice:SortChoice,language='zh'):MergedRow[] {
  const collator=new Intl.Collator(language,{numeric:true,sensitivity:'base'});
  return [...rows].sort((a,b)=>{
    const av=sortValue(a,choice.column),bv=sortValue(b,choice.column);
    const missingA=av===null||(typeof av==='number'&&!Number.isFinite(av)),missingB=bv===null||(typeof bv==='number'&&!Number.isFinite(bv));
    if(missingA!==missingB)return missingA?1:-1;
    const compared=missingA?0:typeof av==='number'&&typeof bv==='number'?av-bv:collator.compare(String(av),String(bv));
    return compared*(choice.direction==='asc'?1:-1)||b.at.localeCompare(a.at)||a.key.localeCompare(b.key);
  });
}
