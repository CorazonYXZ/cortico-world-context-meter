import type {CountTokens} from '../estimate.ts';
import type {Profile} from '../types.ts';
import {Accumulator} from './accumulator.ts';
import {currentRun,LogFiles,Tail} from './tail.ts';
import type {RuntimeIssue,RuntimeReport} from './types.ts';
export interface SessionOptions {
  dataDir:string; profile:Profile; pid:number; counter:()=>Promise<CountTokens>;
  now?:()=>number; audit?:(file:string)=>void;
}
/** Runs inside the worker. It owns all dynamic file reads and transient raw JSON. */
export class ObservationSession {
  private active=false;
  private accumulator:Accumulator|null=null;
  private tails:Partial<Record<'usage'|'tools'|'transcript',Tail>>={};
  private polling:Promise<void>|null=null;
  private readonly now:()=>number;
  constructor(private readonly options:SessionOptions){this.now=options.now??Date.now;}
  async start():Promise<RuntimeReport> {
    const count=await this.options.counter();
    const notes:RuntimeIssue[]=[];
    const files=new LogFiles(this.options.dataDir,this.options.audit);
    const run=await currentRun(files,this.options.pid,issue=>notes.push(issue));
    const note=(issue:RuntimeIssue)=>this.accumulator?this.accumulator.note(issue):notes.push(issue);
    this.tails.usage=new Tail(files,'usage.jsonl',note);
    if(run){this.tails.tools=new Tail(files,`runs/${run}/toolcalls.jsonl`,note);this.tails.transcript=new Tail(files,`runs/${run}/transcript.jsonl`,note);}
    for(const tail of Object.values(this.tails))await tail.baseline();
    this.accumulator=new Accumulator(this.options.profile,this.now(),count,run);
    this.accumulator.report.sources.index=run?'ready':'unavailable';
    for(const issue of notes)this.accumulator.note(issue);
    this.active=true;
    return this.snapshot();
  }
  async poll():Promise<RuntimeReport> {
    if(!this.active)return this.snapshot();
    if(!this.polling){
      this.polling=(async()=>{
        const a=this.accumulator!;
        for(const kind of ['usage','tools','transcript'] as const){
          if(!this.active)break;
          const tail=this.tails[kind];if(!tail)continue;
          await tail.poll(value=>{if(this.active)a[kind==='tools'?'tool':kind](value);},()=>this.active);
        }
      })();
    }
    try{await this.polling;}finally{this.polling=null;}
    return this.snapshot();
  }
  snapshot(stopped=false):RuntimeReport {
    const a=this.accumulator;if(!a)throw new Error('Observation is not initialized.');
    for(const kind of ['usage','tools','transcript'] as const)a.report.sources[kind]=this.tails[kind]?.state??'unavailable';
    const missing=Object.values(a.report.sources).filter(s=>s==='missing'||s==='unavailable').length;
    if(missing)a.report.issues.missing_source=missing;else delete a.report.issues.missing_source;
    return a.snapshot(this.now(),stopped);
  }
  async stop():Promise<RuntimeReport> {
    if(this.polling)await this.polling;
    // Stop remains pending until one bounded final pass finishes; after the reply there are no reads.
    if(this.active)await this.poll();
    this.active=false;
    if(Object.values(this.tails).some(t=>t.incomplete))this.accumulator?.note('stop_incomplete');
    return this.snapshot(true);
  }
}
