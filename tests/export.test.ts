import {describe,it,expect} from 'vitest';
import {createExport} from '../src/export.ts';
import {demoReport,request,tool} from './helpers/runtime-report.ts';
import {emptyRuntime} from '../src/runtime/types.ts';
import type {ScanReport} from '../src/types.ts';

describe('complete metadata export',()=>{
  it('exports all retained records, source states, notices, groups and full association identities',()=>{
    const report=demoReport(205);report.issues.unmatched_result=11;report.truncated=true;
    report.requests.push(request('boundary',[],{boundary:true}),request('reported',[],{basis:'reported'}));
    report.tools.push(tool('unmatched','absent',{textTokens:null,textBasis:null,imageCount:null}));
    const out=createExport(null,report,new Date('2026-10-29T12:00:00Z'));
    expect(out.exportedAt).toBe('2026-10-29T12:00:00.000Z');expect(out.extension.version).toBe('0.5.4');
    expect(out.runtime.requests).toHaveLength(207);expect(out.runtime.tools).toHaveLength(report.tools.length);
    expect(out.runtime.groups).toEqual(report.groups);expect(out.runtime.sources).toEqual(report.sources);
    expect(out.runtime.issues).toEqual({unmatched_result:11});expect(out.runtime.truncated).toBe(true);
    expect(out.runtime.requests[0].id).toBe(report.requests[0].id);
    expect(out.runtime.requests[0].tools).toEqual(report.requests[0].tools);
    expect(out.runtime.tools.at(-1)?.textTokens).toBeNull();expect(out.static).toBeNull();
    expect(out.runtime.meterCoverage.input).toEqual({known:205,unknown:0});
  });
  it('keeps unknown operands unknown and never adds subset or tool tokens to request totals',()=>{
    const report=emptyRuntime();report.requests=[request('known'),request('missing',[],{input:null,cachedInput:null})];
    report.totals={...report.totals,input:100,output:40,cachedInput:70,uncachedInput:60,reasoning:10};
    report.tools=[tool('large','known',{textTokens:999999})];
    const out=createExport(null,report);
    expect(out.runtime.requests[0].totalTokens).toBe(120);expect(out.runtime.requests[1].totalTokens).toBeNull();
    expect(out.runtime.totals.totalTokens).toBe(140);expect(out.runtime.meterCoverage.input).toEqual({known:1,unknown:1});
  });
  it('uses a field allowlist and copies arrays rather than exporting arbitrary upstream fields',()=>{
    const report=demoReport(2),secret='PRIVATE_BODY_KEY_PATH_URL';
    for(const object of [report,report.sources,report.issues,report.totals,...report.requests,...report.tools,...report.groups])
      Object.assign(object,{body:secret,arguments:secret,apiKey:secret,path:secret,url:secret});
    const scan:ScanReport={profile:'v4',estimatedAt:'2026-10-29T12:00:00Z',directoryStatus:'ok',measuredTokens:42,
      completeCount:1,partialCount:0,unavailableCount:0,
      rows:[{name:'cortico-world-public',kind:'world',status:'complete',toolCount:1,toolTokens:40,promptTokens:2,totalTokens:42,share:1,issues:[]}]};
    Object.assign(scan,{raw:secret});Object.assign(scan.rows[0],{prompt:secret});
    const out=createExport(scan,report),json=JSON.stringify(out);
    expect(json).not.toContain(secret);expect(out.static?.rows).toEqual([{name:'cortico-world-public',kind:'world',status:'complete',
      toolCount:1,toolTokens:40,promptTokens:2,totalTokens:42,share:1,issues:[]}]);
    report.requests[0].tools.push('later');scan.rows[0].issues.push('invalid_tool');
    expect(out.runtime.requests[0].tools).not.toContain('later');expect(out.static?.rows[0].issues).toEqual([]);
  });
  it('exports off and recording snapshots without inventing completion or zero counters',()=>{
    const report=emptyRuntime();expect(createExport(null,report).runtime.totals.totalTokens).toBeNull();
    report.state='recording';report.startedAt='2026-10-29T00:00:00Z';
    const out=createExport(null,report);expect(out.runtime.state).toBe('recording');expect(out.runtime.endedAt).toBeNull();
    expect(report.state).toBe('recording');expect(out.extension.displayName).toBe('token计数');
  });
});
