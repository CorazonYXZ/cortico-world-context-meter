import {describe,it,expect} from 'vitest';
import {mergedRows} from '../src/webui/runtime-view.ts';
import {sortRows,sortValue,sortColumns} from '../src/webui/runtime-sort.ts';
import {request,tool} from './helpers/runtime-report.ts';
describe('full merged-row sorting',()=>{
  it('sorts numbers before slicing, keeps unknown last in both directions and preserves stable ties',()=>{
    const requests=Array.from({length:205},(_,i)=>request(String(i),[],{input:i,at:`2026-10-29T04:00:${String(i%60).padStart(2,'0')}Z`}));
    requests.push(request('unknown',[],{input:null}));const rows=mergedRows({requests,tools:[]});
    expect(sortRows(rows,{column:'input',direction:'desc'})[0].request?.id).toBe('204');
    expect(sortRows(rows,{column:'input',direction:'asc'})[0].request?.id).toBe('0');
    for(const direction of ['asc','desc'] as const)expect(sortRows(rows,{column:'input',direction}).at(-1)?.request?.id).toBe('unknown');
    const tied=mergedRows({requests:[request('b'),request('a')],tools:[]});
    expect(sortRows(tied,{column:'input',direction:'asc'}).map(r=>r.key)).toEqual(['request:a','request:b']);
  });
  it('uses explicit multi-tool aggregates, latest completion and any-failed state without changing details',()=>{
    const tools=[tool('a','r',{durationMs:10,textTokens:20,imageCount:2,failed:null}),tool('b','r',{durationMs:30,textTokens:40,imageCount:3,failed:true,at:'2026-10-29T04:00:10Z'})];
    const row=mergedRows({requests:[request('r',['a','b'])],tools})[0];
    expect(sortValue(row,'duration')).toBe(40);expect(sortValue(row,'text')).toBe(60);expect(sortValue(row,'images')).toBe(5);
    expect(sortValue(row,'toolTime')).toBe(Date.parse('2026-10-29T04:00:10Z'));expect(sortValue(row,'failed')).toBe(1);
    row.tools[0].textTokens=null;expect(sortValue(row,'text')).toBeNull();expect(row.tools[1].textTokens).toBe(40);
    expect(sortValue(row,'total')).toBe(120);
  });
  it('supports every column, language-aware text, dates, orphans and immutable input arrays',()=>{
    const rows=mergedRows({requests:[request('r',['a']),request('empty')],tools:[tool('a','r'),tool('z','absent')]});const before=rows.map(r=>r.key);
    for(const column of sortColumns)for(const direction of ['asc','desc'] as const){const sorted=sortRows(rows,{column,direction},'en');expect(sorted).toHaveLength(3);}
    expect(rows.map(r=>r.key)).toEqual(before);expect(sortValue(rows.find(r=>!r.request)!,'input')).toBeNull();
  });
});
