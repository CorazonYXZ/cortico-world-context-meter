import {describe,it,expect} from 'vitest';
import {pieSummary,piePercent,ringPath} from '../src/webui/runtime-pie-model.ts';
import {request,tool,demoReport} from './helpers/runtime-report.ts';
import {emptyRuntime} from '../src/runtime/types.ts';

describe('request-share pie accounting',()=>{
  it('uses input plus output once, merges repeated calls of the same World tool, and ignores subset counters',()=>{
    const report=emptyRuntime();report.requests=[request('one',['a','b','a']),request('two',['c'])];
    report.tools=[tool('a','one'),tool('b','one'),tool('c','two')];
    const result=pieSummary(report);expect(result.total).toBe(240);expect(result.known).toBe(2);
    expect(result.categories).toHaveLength(1);expect(result.categories[0]).toMatchObject({tokens:240,requests:2,kind:'tool'});
  });
  it('keeps same tool names from different Worlds distinct and groups multiple distinct tools as shared',()=>{
    const report=emptyRuntime();report.requests=[request('one',['a']),request('two',['b']),request('three',['c','d'])];
    report.tools=[tool('a','one'),tool('b','two',{owner:'another'}),tool('c','three'),tool('d','three',{tool:'read_file'})];
    const r=pieSummary(report);expect(r.total).toBe(360);expect(r.categories).toHaveLength(3);
    expect(r.categories.filter(c=>c.kind==='tool').map(c=>c.owner).sort()).toEqual(['another','socialmedia']);
    expect(r.categories.find(c=>c.kind==='shared')).toMatchObject({tokens:120,requests:1});
  });
  it('keeps no-tool and missing/conflicting links explicit and never counts orphan tools as requests',()=>{
    const report=emptyRuntime();report.requests=[request('none'),request('pending',['missing']),request('a',['shared'],{responseId:null}),request('b',['shared'],{responseId:null})];
    report.tools=[tool('shared','a',{responseId:null}),tool('orphan','x')];
    const r=pieSummary(report);expect(r.eligible).toBe(4);expect(r.total).toBe(480);
    expect(r.categories.find(c=>c.kind==='none')?.requests).toBe(1);
    expect(r.categories.find(c=>c.kind==='incomplete')).toMatchObject({requests:3,tokens:360});
  });
  it('excludes whole requests with unknown meters and excludes boundary and self-reported requests',()=>{
    const report=emptyRuntime();report.requests=[request('known'),request('unknown',[],{input:null}),request('out',[],{boundary:true}),request('reported',[],{basis:'reported'})];
    const r=pieSummary(report);expect(r).toMatchObject({eligible:2,known:1,unknown:1,total:120,state:'ready'});
    expect(r.slices.reduce((sum,c)=>sum+c.tokens,0)).toBe(120);
  });
  it('distinguishes empty, all unknown, real zero and unsafe aggregate states without invalid slices',()=>{
    const report=emptyRuntime();expect(pieSummary(report).state).toBe('empty');
    report.requests=[request('a',[],{output:null})];expect(pieSummary(report).state).toBe('unknown');
    report.requests=[request('a',[],{input:0,output:0})];expect(pieSummary(report)).toMatchObject({state:'zero',total:0,known:1});
    report.requests=[request('a',[],{input:Number.MAX_SAFE_INTEGER,output:0}),request('b')];
    expect(pieSummary(report)).toMatchObject({state:'overflow',total:null,slices:[]});
  });
  it('uses all requests beyond 200 and deduplicates full request identities',()=>{
    const report=demoReport(250);report.requests.push(report.requests[0]);
    const r=pieSummary(report);expect(r.known).toBe(250);
    expect(r.total).toBe(report.requests.slice(0,250).reduce((sum,q)=>sum+q.input!+q.output!,0));
    expect(r.categories.reduce((sum,c)=>sum+c.requests,0)).toBe(250);
  });
  it('keeps ten categories intact, then takes the largest nine plus Other with complete member detail',()=>{
    const report=emptyRuntime();
    for(let i=0;i<10;i++){report.requests.push(request(String(i),['t'+i],{input:i*100,output:0}));report.tools.push(tool('t'+i,String(i),{tool:'kind'+i}));}
    expect(pieSummary(report).slices).toHaveLength(10);expect(pieSummary(report).slices.some(c=>c.kind==='other')).toBe(false);
    report.requests.push(request('extra',['textra'],{input:2000,output:0}));report.tools.push(tool('textra','extra',{tool:'extra'}));
    const r=pieSummary(report),other=r.slices.at(-1)!;expect(r.slices).toHaveLength(10);expect(other.kind).toBe('other');
    expect(other.members).toHaveLength(2);expect(other.tokens).toBe(100);expect(other.requests).toBe(2);
    expect(r.slices.reduce((sum,c)=>sum+c.tokens,0)).toBe(r.total);
    expect(other.members.reduce((sum,c)=>sum+c.tokens,0)).toBe(other.tokens);
  });
  it('sorts tied categories by stable full identity regardless of incoming order',()=>{
    const r=demoReport(6);for(const q of r.requests){q.input=100;q.output=20;}
    const a=pieSummary(r);r.requests.reverse();r.tools.reverse();expect(pieSummary(r)).toEqual(a);
  });
  it('formats tiny percentages without inflating geometry and draws full circles with finite coordinates',()=>{
    expect(piePercent(1,100000,'zh')).toBe('＜0.1%');expect(piePercent(0,100,'en')).toBe('0.0%');
    expect(piePercent(1,0,'zh')).toBe('—');expect(piePercent(1,4,'en')).toBe('25.0%');
    const path=ringPath(-Math.PI/2,Math.PI*1.5);expect(path.match(/ A /g)).toHaveLength(4);expect(path).not.toMatch(/NaN|Infinity/);
  });
});
