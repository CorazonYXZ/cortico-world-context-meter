import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './fixture.ts';
export const NOW=Date.parse('2026-10-29T01:00:00+08:00');
export const RUN='r-20261029-010000-a1b2';
export const iso=(offset=100)=>new Date(NOW+offset).toISOString();
export function tool(call='call-1',extra:Record<string,unknown>={}){
  return {seq:1,ts:iso(),run:RUN,round:1,resp:'response-1',call,role:'main',tool:'read_file',mod:'example',durMs:20,chars:1000,receipt:'x'.repeat(600),...extra};
}
export function result(call='call-1',output:unknown='TEXT_SENTINEL',extra:Record<string,unknown>={}){
  return {kind:'item',ts:iso(),run:RUN,round:1,index:2,item:{type:'function_call_output',call_id:call,output},context:{},...extra};
}
export function usage(id='attempt-1',extra:Record<string,unknown>={}){
  return {version:2,recordId:id,run:RUN,round:1,ts:iso(50),sessionId:'main',role:'main',label:'DO_NOT_RETAIN_LABEL',model:'deepseek-flash',
    promptTokens:9999,completionTokens:9999,attempt:{id,startedAt:iso(10),elapsedMs:40,responseId:'response-1',outcome:'completed',
      meters:{input:100,output:20,cachedInput:70,uncachedInput:30,reasoning:5}},...extra};
}
export async function runtimeFixture(){
  const f=await fixture();const dataDir=join(f.base,'data');const runDir=join(dataDir,'runs',RUN);
  await mkdir(runDir,{recursive:true});
  const paths={usage:join(dataDir,'usage.jsonl'),index:join(dataDir,'runs/index.jsonl'),tools:join(runDir,'toolcalls.jsonl'),transcript:join(runDir,'transcript.jsonl')};
  for(const path of Object.values(paths))await writeFile(path,'');
  await appendFile(paths.index,JSON.stringify({run:RUN,startedAt:iso(-60000),pid:process.pid})+'\n');
  await writeFile(join(dataDir,'.env'),'API_KEY=PRIVATE_KEY_SENTINEL');
  await writeFile(join(dataDir,'session-main.jsonl'),'PRIVATE_CHAT_SENTINEL');
  await mkdir(join(dataDir,'memory'),{recursive:true});await writeFile(join(dataDir,'memory/private.md'),'PRIVATE_MD_SENTINEL');
  return {...f,dataDir,runDir,paths,
    async append(kind:keyof typeof paths,value:unknown){await appendFile(paths[kind],JSON.stringify(value)+'\n');},
  };
}
