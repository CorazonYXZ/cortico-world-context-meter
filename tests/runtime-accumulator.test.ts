import {describe,it,expect} from 'vitest';
import {Accumulator} from '../src/runtime/accumulator.ts';
import {NOW,RUN,iso,tool,result,usage} from './helpers/runtime-fixture.ts';
const make=()=>new Accumulator('v41',NOW,s=>s.length,RUN);
describe('dynamic metering without invented attribution',()=>{
  it('counts complete Markdown/web results instead of the 600-character summary; drops raw data',()=>{
    const a=make();a.tool(tool());expect(a.snapshot().tools[0].textTokens).toBeNull();
    const body='# PUBLIC_MD_SENTINEL\n'.repeat(100);a.transcript(result('call-1',body));
    const r=a.snapshot(NOW+60000);expect(r.tools[0].textTokens).toBe(body.length);expect(r.tools[0].textBasis).toBe('transcript');
    expect(r.groups[0].perMinute).toBe(1);
    const json=JSON.stringify(r);expect(json).not.toContain('PUBLIC_MD_SENTINEL');expect(json).not.toContain('receipt');
  });
  it('handles out-of-order records and duplicates without double counting or unmatched residues',()=>{
    const a=make();a.transcript(result('call-1','same'));a.transcript(result('call-1','same'));
    a.tool(tool());a.tool(tool());a.usage(usage());a.usage(usage());
    const r=a.snapshot(NOW+60000);expect(r.tools).toHaveLength(1);expect(r.requests).toHaveLength(1);
    expect(r.groups[0].textTokens).toBe(4);expect(r.issues.unmatched_result).toBeUndefined();
  });
  it('pairs concurrent same-name tools by call IDs and responses rather than timestamps',()=>{
    const a=make();a.tool(tool('one'));a.tool(tool('two',{seq:2,resp:'response-2'}));
    a.transcript(result('two','22'));a.transcript(result('one','1'));a.usage(usage());
    a.usage(usage('attempt-2',{attempt:{...usage().attempt,id:'attempt-2',responseId:'response-2'}}));
    const r=a.snapshot();expect(r.tools.map(t=>t.textTokens).sort()).toEqual([1,2]);
    expect(r.requests.map(r=>r.tools.length)).toEqual([1,1]);
    expect(r.requests[0].tools[0]).not.toBe(r.requests[1].tools[0]);
  });
  it('keeps cache and reasoning as subsets and never adds tool text to request input',()=>{
    const a=make();a.usage(usage());a.tool(tool('x',{chars:3,receipt:'123'}));
    const r=a.snapshot();expect(r.totals.input).toBe(100);expect(r.totals.output).toBe(20);
    expect(r.totals.cachedInput).toBe(70);expect(r.totals.reasoning).toBe(5);expect(r.groups[0].textTokens).toBe(3);
  });
  it('preserves missing attempt meters as unknown despite flattened zero fallbacks',()=>{
    const a=make();a.usage(usage('unknown',{promptTokens:0,completionTokens:0,attempt:{...usage().attempt,meters:{input:null,output:null}}}));
    const r=a.snapshot();expect(r.requests[0].input).toBeNull();expect(r.totals.output).toBeNull();expect(r.issues.missing_meter).toBe(1);
  });
  it('separates cross-boundary requests/tools and self-reports, retaining background provider usage',()=>{
    const a=make();a.usage(usage('old',{attempt:{...usage().attempt,startedAt:iso(-100),elapsedMs:300}}));
    a.usage(usage('background',{role:'reflection',round:undefined}));
    a.usage(usage('report',{attempt:undefined,role:'worlds.example',promptTokens:5,completionTokens:2}));
    a.tool(tool('old',{durMs:1000}));const r=a.snapshot();
    expect(r.totals.providerRequests).toBe(1);expect(r.totals.boundaryRequests).toBe(1);expect(r.totals.reportedRecords).toBe(1);
    expect(r.totals.input).toBe(100);expect(r.totals.boundaryTools).toBe(1);expect(r.groups).toEqual([]);
    expect(r.requests.find(r=>r.role==='reflection')?.tools).toEqual([]);
  });
  it('counts image attachments without tokenizing base64/URLs; bounds are conditional and not actual usage',()=>{
    const a=make();a.tool(tool('images',{blobs:3}));expect(a.snapshot().tools[0].imageCount).toBeNull();
    a.transcript(result('images',[{type:'input_text',text:'abc'},{type:'input_image',image_url:'data:image/png;base64,PRIVATE_IMAGE_SENTINEL'}],
      {context:{blobs:[{mime:'image/png',handle:'PRIVATE_PATH_SENTINEL'},{mime:'audio/wav'}]}}));
    const r=a.snapshot();expect(r.tools[0].textTokens).toBe(3);expect(r.tools[0].imageCount).toBe(2);
    expect(r.tools[0].imageTokens).toBeNull();expect(r.tools[0].flashImageUpperBound).toBe(2048);
    expect(JSON.stringify(r)).not.toContain('PRIVATE_');expect(r.totals.input).toBeNull();
    const pro=new Accumulator('v4',NOW,s=>s.length,RUN);pro.tool(tool('images'));pro.transcript(result('images','',{context:{blobs:[{mime:'image/png'}]}}));
    expect(pro.snapshot().tools[0].flashImageUpperBound).toBeNull();
  });
  it('uses a short receipt only when its declared full length agrees and excludes arguments',()=>{
    const a=make();a.tool(tool('short',{receipt:'abc',chars:3,args:{path:'SECRET_FILE.md',command:'ffmpeg SECRET'}}));
    expect(a.snapshot().tools[0].textTokens).toBe(3);expect(JSON.stringify(a.snapshot())).not.toContain('SECRET');
    a.transcript(result('short','abc\n[system] hint'));expect(a.snapshot().tools[0].textTokens).toBe(17);
    expect(a.snapshot().tools[0].textBasis).toBe('transcript');
  });
  it('does not assign Persona tools to a World merely because the file was created by it',()=>{
    const a=make();a.tool(tool('persona',{mod:undefined,args:{path:'worlds/example/notes.md'}}));
    expect(a.snapshot().tools[0].owner).toBe('persona-core');
  });
  it('ignores chat, template instructions, context boundaries and nonexistent result bodies',()=>{
    const a=make();a.transcript({kind:'item',run:RUN,ts:iso(),item:{type:'message',content:'PRIVATE_CHAT_IGNORE_INSTRUCTIONS'}});
    a.transcript({kind:'boundary',run:RUN,ts:iso(),event:'handoff',data:{text:'PRIVATE'}});
    a.tool(tool('missing'));expect(a.snapshot().tools[0].textTokens).toBeNull();expect(JSON.stringify(a.snapshot())).not.toContain('PRIVATE');
  });
  it('rejects inconsistent cache and reasoning meters without manufacturing replacements',()=>{
    const a=make();a.usage(usage('bad',{attempt:{...usage().attempt,meters:{input:1,output:2,cachedInput:5,uncachedInput:0,reasoning:3}}}));
    const r=a.snapshot();expect(r.totals.cachedInput).toBeNull();expect(r.totals.reasoning).toBeNull();expect(r.issues.invalid_record).toBe(2);
  });
  it('does not turn absent attachment metadata into a known zero or crash on impossible times',()=>{
    const a=make();a.tool(tool());a.transcript(result('call-1','abc',{context:undefined}));
    expect(a.snapshot().tools[0].imageCount).toBeNull();
    a.usage(usage('impossible',{attempt:{...usage().attempt,elapsedMs:Number.MAX_SAFE_INTEGER}}));
    expect(a.snapshot().requests).toEqual([]);expect(a.snapshot().issues.invalid_record).toBe(1);
  });
});
