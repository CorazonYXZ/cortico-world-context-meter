import {describe,it,expect} from 'vitest';
import {estimate,canonicalJson} from '../src/estimate.ts';
const tool=(name='read')=>({name,description:'中文 / English',parameters:{type:'object',properties:{text:{type:'string'}}}});
describe('declaration accounting',()=>{
  it('only counts the selected tool fields, not events, summaries, tags or market prose',()=>{
    const base=estimate('a','world',{tools:[tool()]},s=>s.length);
    const extra=estimate('a','world',{tools:[{...tool(),tags:['read'],summary:'not counted',usage:'not counted'}],events:[{description:'not counted'}],summary:'not counted'},s=>s.length);
    expect(extra).toEqual(base);
    expect(base.toolTokens).toBe(canonicalJson([tool()]).length);
  });
  it('keeps variables unexpanded and counts raw prompt text separately',()=>{
    const input='你好 {{example.secret}}\nHello';
    const result=estimate('a','world',{tools:[],prompts:[{key:'env',role:'envPrompt',content:input}]},s=>s.length);
    expect(result.promptTokens).toBe(input.length);expect(result.status).toBe('complete');
  });
  it('valid empty declarations are measurable zero; missing or invalid declarations are unknown',()=>{
    expect(estimate('a','world',{tools:[]},s=>s.length).totalTokens).toBe(0);
    for(const input of [null,{},[],{tools:[{}]},{tools:'wrong'}]) expect(estimate('a','world',input,s=>s.length).totalTokens).toBeNull();
  });
  it('retains known portions without claiming the whole declaration was measured',()=>{
    const row=estimate('a','world',{tools:[tool(),{}],prompts:'broken'},s=>s.length);
    expect(row.status).toBe('partial');expect(row.toolCount).toBe(1);expect(row.promptTokens).toBeNull();expect(row.totalTokens).toBeGreaterThan(0);
  });
  it('deduplicates equivalent tools and excludes conflicting names',()=>{
    const one=estimate('a','world',{tools:[tool()]},s=>s.length);
    const repeated=estimate('a','world',{tools:[tool(),{...tool(),parameters:{properties:{text:{type:'string'}},type:'object'}}]},s=>s.length);
    expect(repeated.totalTokens).toBe(one.totalTokens);expect(repeated.issues).toContain('duplicate_tool');
    const conflict=estimate('a','world',{tools:[tool(),{...tool(),description:'different'}]},s=>s.length);
    expect(conflict.totalTokens).toBeNull();expect(conflict.issues).toContain('conflicting_tool');
  });
  it('deduplicates identical prompt keys and excludes conflicting ones',()=>{
    const p={key:'x',role:'prefix',content:'hello'};
    const repeated=estimate('a','bot',{tools:[],prompts:[p,p]},s=>s.length);
    expect(repeated.promptTokens).toBe(5);expect(repeated.issues).toContain('duplicate_prompt');
    expect(estimate('a','bot',{tools:[],prompts:[p,{...p,content:'other'}]},s=>s.length).promptTokens).toBeNull();
  });
  it('provider descriptions without context are not applicable, not zero spend',()=>{
    const row=estimate('p','provider',{provider:{protocols:['openai'],auth:['api-key'],local:false,input:['text']}},s=>s.length);
    expect(row.status).toBe('not_applicable');expect(row.totalTokens).toBeNull();
  });
  it('canonical ordering is independent of object insertion order and preserves array order',()=>{
    expect(canonicalJson({z:1,a:{y:2,x:3},v:[3,1]})).toBe('{"a":{"x":3,"y":2},"v":[3,1],"z":1}');
  });
});
