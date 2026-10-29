import {open,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {contained} from '../files.ts';
import type {RuntimeIssue,SourceState} from './types.ts';
export const RUN_ID=/^r-\d{8}-\d{6}-[a-f0-9]{4}$/;
export const RECORD_LIMIT=16*1024*1024;
const CHUNK=64*1024;
export type Note=(issue:RuntimeIssue)=>void;
/** The sole dynamic filesystem seam. Only four explicitly authorized log names are accepted. */
export class LogFiles {
  private root:string|null=null;
  constructor(private readonly directory:string,private readonly audit?:(file:string)=>void){}
  async file(name:string) {
    if(name!=='usage.jsonl' && name!=='runs/index.jsonl' && !/^runs\/r-\d{8}-\d{6}-[a-f0-9]{4}\/(toolcalls|transcript)\.jsonl$/.test(name))
      throw Object.assign(new Error('unsafe_path'),{code:'UNSAFE'});
    this.root ??= await realpath(this.directory);
    const candidate=join(this.root,...name.split('/'));
    const actual=await realpath(candidate);
    const same=process.platform==='win32'?actual.toLowerCase()===candidate.toLowerCase():actual===candidate;
    if(!contained(this.root,actual)||!same)throw Object.assign(new Error('unsafe_path'),{code:'UNSAFE'});
    this.audit?.(actual);
    const handle=await open(actual,'r');
    try {
      const stat=await handle.stat();
      if(!stat.isFile())throw Object.assign(new Error('unsafe_path'),{code:'UNSAFE'});
      return {handle,stat};
    }catch(error){await handle.close();throw error;}
  }
}
function issueFor(error:unknown):RuntimeIssue {
  return (error as NodeJS.ErrnoException).code==='UNSAFE'?'unsafe_path':'unreadable_source';
}
export class Tail {
  state:SourceState='unavailable';
  private offset=0;
  private identity:string|null=null;
  private parts:Buffer[]=[];
  private length=0;
  private dropping=false;
  private missingReported=false;
  private backlog=false;
  get incomplete():boolean {return this.backlog||this.length>0;}
  constructor(private readonly files:LogFiles,readonly name:string,private readonly note:Note){}
  private key(stat:{dev:number;ino:number;birthtimeMs:number}){return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;}
  async baseline():Promise<void> {
    try {
      const {handle,stat}=await this.files.file(this.name);
      try {this.offset=stat.size;this.identity=this.key(stat);this.state='ready';
        // If the pre-existing last line is unfinished, discard its future suffix as well.
        if(stat.size){const byte=Buffer.alloc(1);await handle.read(byte,0,1,stat.size-1);this.dropping=byte[0]!==10;}
      }finally{await handle.close();}
    }catch(error){this.failed(error);}
  }
  private failed(error:unknown) {
    if((error as NodeJS.ErrnoException).code==='ENOENT') {
      this.state='missing';if(!this.missingReported){this.note('missing_source');this.missingReported=true;}
    }else{this.state='unreadable';this.note(issueFor(error));}
  }
  async poll(accept:(value:unknown)=>void,active:()=>boolean=()=>true):Promise<void> {
    if(!active())return;
    let opened:Awaited<ReturnType<LogFiles['file']>>;
    try {opened=await this.files.file(this.name);}catch(error){this.failed(error);return;}
    const {handle,stat}=opened;
    try {
      if(!active())return;
      if(this.identity!==null && (this.key(stat)!==this.identity || stat.size<this.offset)) {
        this.note('source_changed');this.state='changed';this.offset=stat.size;this.identity=this.key(stat);
        this.parts=[];this.length=0;this.dropping=false;this.backlog=false;
        if(stat.size&&active()){const byte=Buffer.alloc(1);await handle.read(byte,0,1,stat.size-1);this.dropping=byte[0]!==10;}
        return;
      }
      this.identity=this.key(stat);this.state='ready';
      // Up to 4 MiB per file per pass; carry partial lines without retaining more than the limit.
      const end=Math.min(stat.size,this.offset+4*1024*1024);
      while(this.offset<end && active()) {
        const bytes=Buffer.alloc(Math.min(CHUNK,end-this.offset));
        const {bytesRead}=await handle.read(bytes,0,bytes.length,this.offset);
        if(!bytesRead)break;
        this.offset+=bytesRead;
        if(!active())return;
        this.feed(bytes.subarray(0,bytesRead),accept);
      }
      this.backlog=this.offset<stat.size;
    }finally{await handle.close();}
  }
  private feed(bytes:Buffer,accept:(value:unknown)=>void) {
    let start=0;
    while(start<bytes.length){
      const lf=bytes.indexOf(10,start);const end=lf===-1?bytes.length:lf;
      const part=bytes.subarray(start,end);
      if(!this.dropping){
        this.length+=part.length;
        if(this.length>RECORD_LIMIT){this.parts=[];this.length=0;this.dropping=true;this.note('oversized_record');}
        else this.parts.push(part);
      }
      if(lf===-1)break;
      if(!this.dropping && this.length){
        let value:unknown;
        try {value=JSON.parse(Buffer.concat(this.parts,this.length).toString('utf8'));}
        catch {this.note('invalid_record');value=undefined;}
        if(value!==undefined)accept(value);
      }
      this.parts=[];this.length=0;this.dropping=false;start=lf+1;
    }
  }
}
/** Only bounded run metadata is read backwards; never reads old tool/chat records. */
export async function currentRun(files:LogFiles,pid:number,note:Note):Promise<string|null> {
  let opened:Awaited<ReturnType<LogFiles['file']>>;
  try {opened=await files.file('runs/index.jsonl');}catch(error){note((error as NodeJS.ErrnoException).code==='ENOENT'?'missing_source':issueFor(error));return null;}
  const {handle,stat}=opened;
  try {
    const start=Math.max(0,stat.size-64*1024);const bytes=Buffer.alloc(stat.size-start);
    const {bytesRead}=await handle.read(bytes,0,bytes.length,start);
    let lines=bytes.subarray(0,bytesRead).toString('utf8').split('\n');
    if(start)lines=lines.slice(1);
    const closed=new Set<string>();
    for(const line of lines.reverse()){
      if(!line.trim())continue;
      let row:Record<string,unknown>;
      try {row=JSON.parse(line);}catch {note('invalid_record');continue;}
      if(!row || typeof row!=='object' || typeof row.run!=='string' || !RUN_ID.test(row.run))continue;
      if(typeof row.endedAt==='string'){closed.add(row.run);continue;}
      if(row.pid===pid && !closed.has(row.run))return row.run;
    }
    note('missing_source');return null;
  }finally{await handle.close();}
}
