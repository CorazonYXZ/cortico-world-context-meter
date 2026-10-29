import {describe,it,expect} from 'vitest';
import {mergedRows,requestTotal} from '../src/webui/runtime-view.ts';
import {request,tool,demoReport} from './helpers/runtime-report.ts';
describe('request/tool presentation joins',()=>{
  it('joins full identities even when times differ and totals only input plus output',()=>{
    const r=request('one',['a']),t=tool('a','one');
    const rows=mergedRows({requests:[r],tools:[t]});expect(rows).toHaveLength(1);
    expect(rows[0].at).toBe(r.at);expect(rows[0].tools[0].at).not.toBe(r.at);expect(rows[0].totalTokens).toBe(120);
  });
  it('uses one request row for multiple tools and deduplicates repeated references',()=>{
    const rows=mergedRows({requests:[request('one',['a','b','a'])],tools:[tool('a','one'),tool('b','one')]});
    expect(rows).toHaveLength(1);expect(rows[0].tools).toHaveLength(2);expect(rows[0].totalTokens).toBe(120);
  });
  it('does not join matching time stamps, response prefixes or shortened request IDs',()=>{
    const a=request('12345678-one',['a']),b=request('12345678-two',['b']);
    const rows=mergedRows({requests:[a,b],tools:[tool('a',a.id),tool('b',b.id)]});
    expect(rows.find(r=>r.request?.id===a.id)?.tools.map(t=>t.id)).toEqual(['a']);
    expect(rows.find(r=>r.request?.id===b.id)?.tools.map(t=>t.id)).toEqual(['b']);
    const unlinked=mergedRows({requests:[a],tools:[tool('other','not-a',{at:a.at})]});expect(unlinked).toHaveLength(2);
  });
  it('preserves requests without tools and orphan tools with unknown request meters',()=>{
    const rows=mergedRows({requests:[request('one')],tools:[tool('orphan','no-request')]});
    expect(rows.find(r=>r.request)?.link).toBe('none');const orphan=rows.find(r=>!r.request)!;
    expect(orphan.link).toBe('unmatched');expect(orphan.totalTokens).toBeNull();
  });
  it('keeps ambiguous tool ownership separate instead of duplicating it on several requests',()=>{
    const rows=mergedRows({requests:[request('one',['a'],{responseId:null}),request('two',['a'],{responseId:null})],tools:[tool('a','one',{responseId:null})]});
    expect(rows).toHaveLength(3);expect(rows.filter(r=>r.request).every(r=>r.tools.length===0&&r.pendingLinks===1)).toBe(true);
    expect(rows.find(r=>!r.request)?.candidateRequests).toEqual(['one','two']);
  });
  it('rejects supplied links with conflicting run, role or known response IDs',()=>{
    for(const extra of [{run:'another'},{role:'fork'},{responseId:'different'}]){
      const rows=mergedRows({requests:[request('one',['a'])],tools:[tool('a','one',extra)]});
      expect(rows.find(r=>r.request)?.tools).toEqual([]);expect(rows.find(r=>!r.request)).toBeDefined();
    }
  });
  it('joins all retained tools before applying a display limit and does not mutate the report',()=>{
    const report=demoReport(205),before=JSON.stringify(report);report.tools.reverse();const reverse=JSON.stringify(report);
    const rows=mergedRows(report);expect(rows).toHaveLength(205);expect(rows.every(r=>r.tools.length>0)).toBe(true);
    expect(JSON.stringify(report)).toBe(reverse);expect(before).not.toBe(reverse);
  });
  it('keeps missing operands unknown, accepts real zero, and rejects unsafe totals',()=>{
    expect(requestTotal({input:null,output:5})).toBeNull();expect(requestTotal({input:10,output:null})).toBeNull();
    expect(requestTotal({input:0,output:0})).toBe(0);expect(requestTotal({input:Number.MAX_SAFE_INTEGER,output:1})).toBeNull();
  });
});
