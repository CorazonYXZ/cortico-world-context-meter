import {Worker,type WorkerOptions} from 'node:worker_threads';
import type {StatisticsExport} from '../export.ts';
import {XLSX_MIME,type ExportCode} from '../excel-protocol.ts';
export interface BinaryExport {$binary:{mime:string;base64:string};}
export interface ExcelOptions {timeoutMs?:number;workerUrl?:URL;workerFactory?:(url:URL,options:WorkerOptions)=>Worker;}
interface Job {owner:string;worker:Worker|null;started:boolean;finishing:boolean;timer:ReturnType<typeof setTimeout>|null;
  resolve:(value:BinaryExport)=>void;reject:(error:Error)=>void;done:Promise<void>;release:()=>void;}
/** One in-memory job per World. No logs, subprocesses, source records or output files. */
export class ExcelExporter {
  private job:Job|null=null;
  private closed=false;
  private readonly cancelled=new Map<string,number>();
  constructor(private readonly options:ExcelOptions={}){}
  resume(){this.closed=false;this.cancelled.clear();}
  generate(owner:string,snapshot:()=>Promise<StatisticsExport>,language:string):Promise<BinaryExport>{
    if(this.closed)return Promise.reject(new Error('E_XLSX_UNAVAILABLE'));
    for(const [id,until] of this.cancelled)if(until<=Date.now())this.cancelled.delete(id);
    if(this.cancelled.has(owner))return Promise.reject(new Error('E_XLSX_CANCELLED'));
    if(this.job)return Promise.reject(new Error('E_XLSX_BUSY'));
    let resolve!:(value:BinaryExport)=>void,reject!:(error:Error)=>void,release!:()=>void;
    const result=new Promise<BinaryExport>((yes,no)=>{resolve=yes;reject=no;}),done=new Promise<void>(yes=>{release=yes;});
    const job:Job={owner,worker:null,started:false,finishing:false,timer:null,resolve,reject,done,release};this.job=job;
    job.timer=setTimeout(()=>{void this.finish(job,'E_XLSX_TIMEOUT');},this.options.timeoutMs??60000);job.timer.unref();
    void (async()=>{
      let report:StatisticsExport;
      try{report=await snapshot();}catch{await this.finish(job,'E_EXPORT_DATA');return;}
      if(job.finishing||this.job!==job)return;
      try{
        const options:WorkerOptions={workerData:{report,language},execArgv:[],stdout:true,stderr:true};
        const url=this.options.workerUrl??new URL('../../dist/xlsx-export-worker.mjs',import.meta.url);
        const worker=this.options.workerFactory?this.options.workerFactory(url,options):new Worker(url,options);job.worker=worker;
        worker.stdout?.resume();worker.stderr?.resume();
        worker.on('message',message=>{
          if(job.finishing)return;
          if(message?.type==='started'){job.started=true;return;}
          if(message?.type==='result'&&message.bytes instanceof ArrayBuffer){
            const bytes=new Uint8Array(message.bytes);
            if(bytes.length<4||bytes[0]!==80||bytes[1]!==75){void this.finish(job,'E_XLSX_GENERATE');return;}
            void this.finish(job,null,{$binary:{mime:XLSX_MIME,base64:Buffer.from(bytes).toString('base64')}});
          }else void this.finish(job,'E_XLSX_GENERATE');
        });
        worker.on('error',()=>{void this.finish(job,job.started?'E_XLSX_GENERATE':'E_XLSX_START');});
        worker.on('exit',()=>{if(!job.finishing)void this.finish(job,job.started?'E_XLSX_GENERATE':'E_XLSX_START');});
      }catch{await this.finish(job,'E_XLSX_START');}
    })();
    return result;
  }
  private async finish(job:Job,code:ExportCode|null,value?:BinaryExport){
    if(job.finishing)return job.done;job.finishing=true;if(job.timer)clearTimeout(job.timer);
    try{if(job.worker)await job.worker.terminate();}
    catch{code??='E_XLSX_GENERATE';}
    finally{
      if(this.job===job)this.job=null;
      if(code)job.reject(new Error(code));else job.resolve(value!);job.release();
    }
  }
  async cancel(owner:string):Promise<boolean>{
    // An unmount notification can reach the server before its aborted export request.
    this.cancelled.set(owner,Date.now()+60000);if(this.cancelled.size>128)this.cancelled.delete(this.cancelled.keys().next().value!);
    const job=this.job;if(!job||job.owner!==owner)return false;
    await this.finish(job,'E_XLSX_CANCELLED');return true;}
  async dispose(){this.closed=true;if(this.job)await this.finish(this.job,'E_XLSX_CANCELLED');}
}
