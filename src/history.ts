import {mkdir,lstat,realpath,open,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createExport,type StatisticsExport} from './export.ts';
import {validateSnapshot} from './history-validation.ts';
import type {HistoryEntry,HistoryList,SavedState} from './history-types.ts';
export const HISTORY_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_FILE=32*1024*1024,MAX_BYTES=64*1024*1024,MAX_ENTRIES=30,TTL=7*86400000;
const failure=()=>new Error('History storage unavailable.');
export interface StoredHistory {entry:HistoryEntry;payload:StatisticsExport;}
export interface HistoryOptions {now?:()=>number;maxBytes?:number;maxEntries?:number;ttlMs?:number;audit?:(operation:string,file:string)=>void;}
const title=(start:string,end:string)=>{
  const format=(s:string)=>{const d=new Date(s),pad=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;};
  return `${format(start)}—${format(end)}`;
};
export function validHistoryName(value:unknown):value is string {
  return typeof value==='string'&&value.trim().length>0&&[...value].length<=80&&!/[\x00-\x1f\x7f]/.test(value);
}
export class HistoryStore {
  private queue:Promise<unknown>=Promise.resolve();private root:string|null=null;
  private readonly now:()=>number;
  constructor(private readonly dataDir:string,private readonly options:HistoryOptions={}){this.now=options.now??Date.now;}
  private serial<T>(task:()=>Promise<T>):Promise<T>{const next=this.queue.then(task,task).catch(()=>{throw failure();});this.queue=next.catch(()=>{});return next;}
  private async directory(){
    if(!this.dataDir)throw failure();
    if(!this.root){
      let dir=await realpath(resolve(this.dataDir));if(!(await lstat(dir)).isDirectory())throw failure();
      for(const part of ['context-meter','history']){
        dir=join(dir,part);try{await mkdir(dir);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
        const stat=await lstat(dir);if(stat.isSymbolicLink()||!stat.isDirectory()||await realpath(dir)!==dir)throw failure();
      }
      this.root=dir;
    }
    if(await realpath(this.root)!==this.root||(await lstat(this.root)).isSymbolicLink())throw failure();
    return this.root;
  }
  private async path(name:string){const dir=await this.directory();return join(dir,name);}
  private async checked(name:string,missing=false){
    const path=await this.path(name);
    try{const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1||await realpath(path)!==path)throw failure();return {path,stat};}
    catch(e){if(missing&&(e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  }
  private async read(name:string,max:number){
    const checked=await this.checked(name,true);if(!checked)return null;
    const {path,stat}=checked;if(stat.size>max)throw failure();this.options.audit?.('read',path);
    const handle=await open(path,'r');
    try{const current=await handle.stat();if(current.dev!==stat.dev||current.ino!==stat.ino||current.size!==stat.size)throw failure();
      const buffer=Buffer.alloc(stat.size);let offset=0;
      while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)throw failure();offset+=bytesRead;}
      return JSON.parse(buffer.toString('utf8')) as unknown;
    }finally{await handle.close();}
  }
  private async remove(name:string){const file=await this.checked(name,true);if(file){this.options.audit?.('delete',file.path);await unlink(file.path);}}
  private async write(name:string,value:unknown){
    const data=JSON.stringify(value)+'\n';if(Buffer.byteLength(data)>MAX_FILE)throw failure();
    await this.checked(name,true);const path=await this.path(name),temp=await this.path('.pending.json');
    await this.remove('.pending.json');this.options.audit?.('write',path);
    const handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(data,'utf8');await handle.sync();}finally{await handle.close();}
    try{await this.directory();await this.checked(name,true);await rename(temp,path);}catch(e){await this.remove('.pending.json').catch(()=>{});throw e;}
    return Buffer.byteLength(data);
  }
  private async index():Promise<string[]>{
    const value=await this.read('index.json',256*1024);if(value===null)return [];
    const v=value as {schemaVersion?:number;ids?:unknown};
    if(v.schemaVersion!==1||!Array.isArray(v.ids)||v.ids.length>100||!v.ids.every(id=>typeof id==='string'&&HISTORY_ID.test(id)))throw failure();
    return [...new Set(v.ids)] as string[];
  }
  private async entry(id:string):Promise<StoredHistory>{
    if(!HISTORY_ID.test(id))throw failure();const value=await this.read(`${id}.json`,MAX_FILE);
    const v=value as {schemaVersion?:number;entry?:HistoryEntry;payload?:unknown}|null,e=v?.entry;
    if(!v||v.schemaVersion!==1||!e||e.id!==id||!validHistoryName(e.name)||typeof e.renamed!=='boolean'||
      !['recording','stopped','interrupted'].includes(e.status)||!Number.isFinite(Date.parse(e.startedAt))||
      !Number.isFinite(Date.parse(e.checkpointAt))||!Number.isFinite(Date.parse(e.retentionAt))||
      (e.endedAt!==null&&!Number.isFinite(Date.parse(e.endedAt))))throw failure();
    const payload=validateSnapshot(v.payload);if(payload.runtime.startedAt!==e.startedAt)throw failure();
    const total=payload.runtime.totals.totalTokens;
    const clean:HistoryEntry={id,name:e.name,renamed:e.renamed,startedAt:e.startedAt,endedAt:e.endedAt,checkpointAt:e.checkpointAt,
      retentionAt:e.retentionAt,status:e.status,requests:payload.runtime.totals.providerRequests,totalTokens:total,
      incomplete:payload.runtime.truncated||Object.keys(payload.runtime.issues).length>0,bytes:(await this.checked(`${id}.json`))!.stat.size};
    return {entry:clean,payload};
  }
  private async collect(activeId:string|null){
    const ids=await this.index(),records:StoredHistory[]=[];let warnings=0;
    for(const id of ids){try{records.push(await this.entry(id));}catch{warnings++;}}
    records.sort((a,b)=>Number(b.entry.id===activeId)-Number(a.entry.id===activeId)||b.entry.retentionAt.localeCompare(a.entry.retentionAt)||a.entry.id.localeCompare(b.entry.id));
    let bytes=0,count=0;const retained:StoredHistory[]=[];const keep=new Set(ids.filter(id=>!records.some(r=>r.entry.id===id)));
    for(const record of records){const e=record.entry;
      const expired=this.now()-Date.parse(e.retentionAt)>(this.options.ttlMs??TTL);
      if(e.id!==activeId&&(expired||count>=(this.options.maxEntries??MAX_ENTRIES)||bytes+e.bytes>(this.options.maxBytes??MAX_BYTES))){
        try{await this.remove(`${e.id}.json`);}catch{keep.add(e.id);warnings++;}continue;
      }
      retained.push(record);keep.add(e.id);count++;bytes+=e.bytes;
    }
    // Corrupt registered records remain registered for explicit deletion; never inspect unrelated files.
    if(ids.length!==keep.size||ids.some(id=>!keep.has(id)))await this.write('index.json',{schemaVersion:1,ids:[...keep]});
    for(const r of retained)if(r.entry.status==='recording'&&r.entry.id!==activeId){r.entry.status='interrupted';r.entry.incomplete=true;}
    return {records:retained,warnings};
  }
  list(activeId:string|null=null):Promise<HistoryList>{return this.serial(async()=>{
    const {records,warnings}=await this.collect(activeId);return {entries:records.map(r=>r.entry),warnings,saveFailed:false};
  });}
  get(id:string,activeId:string|null=null):Promise<StoredHistory>{return this.serial(async()=>{
    const {records}=await this.collect(activeId);const record=records.find(r=>r.entry.id===id);if(!record)throw failure();return this.selected(record);
  });}
  private selected(record:StoredHistory){
    const {entry,payload}=record;payload.selection={id:entry.id,name:entry.name,status:entry.status,checkpointAt:entry.checkpointAt};
    if(entry.status==='interrupted'){payload.runtime.state='stopped';payload.runtime.endedAt=null;}
    return {entry,payload};
  }
  save(payload:StatisticsExport,id:string|null=null):Promise<HistoryEntry>{return this.serial(async()=>{
    const clean=validateSnapshot(payload),r=clean.runtime;if(!r.startedAt)throw failure();
    const ids=await this.index();id??=randomUUID();if(!HISTORY_ID.test(id))throw failure();
    const previous=ids.includes(id)?await this.entry(id):null;
    const status:SavedState=r.state==='recording'||r.state==='starting'?'recording':'stopped';
    const end=r.endedAt??r.updatedAt??new Date(this.now()).toISOString();
    const entry:HistoryEntry={id,name:previous?.entry.renamed?previous.entry.name:title(r.startedAt,end),renamed:previous?.entry.renamed??false,
      startedAt:r.startedAt,endedAt:r.endedAt,checkpointAt:new Date(this.now()).toISOString(),retentionAt:r.endedAt??new Date(this.now()).toISOString(),
      status,requests:r.totals.providerRequests,totalTokens:r.totals.totalTokens,incomplete:r.truncated||Object.keys(r.issues).length>0,bytes:0};
    const file={schemaVersion:1,entry,payload:clean};entry.bytes=await this.write(`${id}.json`,file);
    if(!ids.includes(id)){
      try{await this.write('index.json',{schemaVersion:1,ids:[...ids,id]});}catch(e){await this.remove(`${id}.json`).catch(()=>{});throw e;}
    }
    await this.collect(status==='recording'?id:null);return entry;
  });}
  rename(id:string,name:string,activeId:string|null=null):Promise<HistoryEntry>{return this.serial(async()=>{
    if(!validHistoryName(name))throw failure();const {records}=await this.collect(activeId),record=records.find(r=>r.entry.id===id);if(!record)throw failure();
    record.entry.name=name.trim();record.entry.renamed=true;
    await this.write(`${id}.json`,{schemaVersion:1,...record});return record.entry;
  });}
  delete(id:string,activeId:string|null=null):Promise<void>{return this.serial(async()=>{
    if(!HISTORY_ID.test(id)||id===activeId)throw failure();const ids=await this.index();if(!ids.includes(id))throw failure();
    await this.remove(`${id}.json`);await this.write('index.json',{schemaVersion:1,ids:ids.filter(v=>v!==id)});
  });}
}
