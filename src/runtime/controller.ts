import {Worker,type WorkerOptions} from 'node:worker_threads';
import type {Profile} from '../types.ts';
import {emptyRuntime,type RuntimeReport} from './types.ts';
export interface Observer {
  start(profile:Profile):Promise<RuntimeReport>;stop():Promise<RuntimeReport>;
  status():RuntimeReport;clear():Promise<RuntimeReport>;
}
export interface ObserverOptions {dataDir:string;workerUrl?:URL;execArgv?:WorkerOptions['execArgv'];}
export class RuntimeObserver implements Observer {
  private report=emptyRuntime();
  private worker:Worker|null=null;
  private queue:Promise<unknown>=Promise.resolve();
  private stoppedResolve:(()=>void)|null=null;
  constructor(private readonly options:ObserverOptions){}
  status():RuntimeReport {return structuredClone(this.report);}
  private serial<T>(fn:()=>Promise<T>):Promise<T> {
    const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;
  }
  start(profile:Profile):Promise<RuntimeReport> {return this.serial(async()=>{
    if(this.worker){if(profile!==this.report.profile)throw new Error('Stop observation before changing its profile.');return this.status();}
    this.report=emptyRuntime(profile);this.report.state='starting';
    let readyResolve!:()=>void,readyReject!:()=>void;
    const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=()=>reject(new Error('Observer unavailable.'));});
    let worker:Worker;
    try{worker=new Worker(this.options.workerUrl??new URL('../../dist/observer-worker.mjs',import.meta.url),{
      workerData:{dataDir:this.options.dataDir,profile,pid:process.pid},execArgv:this.options.execArgv??[],stdout:true,stderr:true});}
    catch{this.report.state='error';this.report.issues.worker_failed=1;throw new Error('Observer unavailable.');}
    this.worker=worker;
    // Nothing printed by the worker, including a parser exception, reaches host logs.
    worker.stdout?.resume();worker.stderr?.resume();
    const failed=()=>{
      if(this.worker!==worker)return;
      this.worker=null;this.report.state='error';this.report.issues.worker_failed=1;
      readyReject();this.stoppedResolve?.();this.stoppedResolve=null;void worker.terminate();
    };
    worker.on('message',message=>{
      if(this.worker!==worker)return;
      if(message?.type==='failed'){failed();return;}
      if(message?.type!=='report'||!message.report)return;
      this.report=message.report as RuntimeReport;
      readyResolve();if(this.report.state==='stopped'){this.stoppedResolve?.();this.stoppedResolve=null;}
    });
    worker.on('error',failed);
    worker.on('exit',()=>{if(this.worker===worker&&this.report.state!=='stopped')failed();});
    const timeout=setTimeout(readyReject,15000);
    try{await ready;return this.status();}
    catch{failed();throw new Error('Observer unavailable.');}
    finally{clearTimeout(timeout);}
  });}
  stop():Promise<RuntimeReport> {return this.serial(async()=>{
    const worker=this.worker;
    if(!worker)return this.status();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const stopped=new Promise<void>(resolve=>{
      this.stoppedResolve=resolve;timer=setTimeout(()=>{this.report.issues.stop_incomplete=1;resolve();},5000);
    });
    worker.postMessage({type:'stop'});await stopped;
    if(timer)clearTimeout(timer);
    await worker.terminate();this.stoppedResolve=null;this.worker=null;
    if(this.report.state!=='error'){this.report.state='stopped';this.report.endedAt??=new Date().toISOString();}
    return this.status();
  });}
  clear():Promise<RuntimeReport> {return this.serial(async()=>{
    if(this.worker||this.report.state==='starting'||this.report.state==='recording')throw new Error('Stop observation before clearing it.');
    this.report=emptyRuntime(this.report.profile);return this.status();
  });}
}
