import type { World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { ContextMeterConfig } from './config.ts';
import { scan } from './scanner.ts';
import { loadCounter } from './tokenizer.ts';
import { isProfile, type Profile, type ScanReport } from './types.ts';
import type { CountTokens } from './estimate.ts';
import {RuntimeObserver,type Observer} from './runtime/controller.ts';
import {createExport} from './export.ts';
import {HistoryStore,HISTORY_ID,validHistoryName} from './history.ts';
import type {HistoryEntry} from './history-types.ts';
import {randomUUID} from 'node:crypto';
import {ExcelExporter} from './excel/controller.ts';
import {OWNER_ID} from './excel-protocol.ts';
import {isLanguage} from 'cortico/core/language.ts';
export interface ContextMeterOptions {
  cfg:ContextMeterConfig; directory:string; persist:(profile:Profile)=>void;
  counter?:(profile:Profile)=>Promise<CountTokens>;
  dataDir?:string;observer?:Observer;
}
export class ContextMeterWorld implements World {
  readonly id='context-meter';
  private pending:Promise<ScanReport> | null=null;
  private lastScan:ScanReport|null=null;
  private stopped=false;
  private started=false;
  private readonly observer:Observer;
  private readonly history:HistoryStore|null;
  private readonly excel=new ExcelExporter();
  private currentId:string|null=null;
  private saved:HistoryEntry|null=null;
  private saveFailed=false;
  private timer:ReturnType<typeof setInterval>|null=null;
  private operations:Promise<unknown>=Promise.resolve();
  private checkpointQueued=false;
  private skipArchiveCurrent=false;
  constructor(private readonly options:ContextMeterOptions) {
    this.observer=options.observer??new RuntimeObserver({dataDir:options.dataDir??''});
    this.history=options.dataDir?new HistoryStore(options.dataDir):null;
  }
  envPromptVars():null { return null; }
  tools() { return []; }
  // Observation stays off during mounting; no host calls, reads, model calls or events.
  async start(_host:WorldHost):Promise<void> { this.stopped=false;this.started=true;this.excel.resume(); }
  async stop():Promise<void> {
    this.stopped=true;this.started=false;this.stopTimer();
    await this.excel.dispose();
    await this.serial(async()=>{this.stopTimer();await this.observer.stop();await this.checkpoint().catch(()=>{});});
  }
  private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.operations.then(fn,fn);this.operations=next.catch(()=>{});return next;}
  private stopTimer(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  private activeId(){const state=this.observer.status().state;return state==='starting'||state==='recording'?this.currentId:null;}
  private status(){const report=this.observer.status();if(report.state==='off')report.profile=this.options.cfg.profile;
    if(this.saveFailed)report.historySaveFailed=true;return report;}
  private currentExport(){return createExport(this.lastScan,this.status(),new Date(),{
    id:this.currentId,name:this.saved?.name??null,status:this.activeId()?'recording':this.currentId?'stopped':'off',checkpointAt:this.saved?.checkpointAt??null});}
  private async exportSnapshot(id:unknown){
    if(id===null)return this.currentExport();
    if(!this.history||typeof id!=='string'||!HISTORY_ID.test(id))throw new Error('E_EXPORT_ARGS');
    const record=await this.history.get(id,this.activeId());record.payload.exportedAt=new Date().toISOString();return record.payload;
  }
  private async checkpoint(){
    const report=this.observer.status();if(!this.history||!report.startedAt||this.skipArchiveCurrent)return;
    this.currentId??=randomUUID();
    try{this.saved=await this.history.save(this.currentExport(),this.currentId);this.saveFailed=false;}
    catch{this.saveFailed=true;throw new Error('History could not be saved.');}
  }
  private startTimer(){
    this.stopTimer();this.timer=setInterval(()=>{
      if(this.checkpointQueued)return;this.checkpointQueued=true;
      void this.serial(async()=>{if(this.activeId())await this.checkpoint();}).catch(()=>{}).finally(()=>{this.checkpointQueued=false;});
    },10000);this.timer.unref();
  }
  webUi(language:Language='zh'):WorldWebUiDecl {
    const zh=language==='zh' || language==='zh-Hant';
    return {
      label:zh?'token计数':'Token count',
      panels:[{id:'overview',title:zh?'扩展静态上下文排行':'Declared context ranking'},
        {id:'runtime',title:zh?'运行观察':'Runtime observation'}],
      invoke:async(panel,method,args)=>{
        if((panel==='overview'||panel==='runtime')&&method==='export.xlsx'){
          const [id,language,owner]=args;
          if(args.length!==3||(id!==null&&(typeof id!=='string'||!HISTORY_ID.test(id)))||!isLanguage(language)||typeof owner!=='string'||!OWNER_ID.test(owner))throw new Error('E_EXPORT_ARGS');
          return this.excel.generate(owner,()=>this.exportSnapshot(id),language);
        }
        if((panel==='overview'||panel==='runtime')&&method==='export.cancel'){
          if(args.length!==1||typeof args[0]!=='string'||!OWNER_ID.test(args[0]))throw new Error('E_EXPORT_ARGS');
          return this.excel.cancel(args[0]);
        }
        if((panel==='overview'||panel==='runtime')&&method==='export'&&args.length<=1){
          if(!args.length)return this.currentExport();
          if(!this.history||typeof args[0]!=='string'||!HISTORY_ID.test(args[0]))throw new Error('Invalid history selection.');
          const record=await this.history.get(args[0],this.activeId());record.payload.exportedAt=new Date().toISOString();return record.payload;
        }
        if(panel==='runtime'&&method.startsWith('history.')){
          if(!this.history){if(method==='history.list'&&!args.length)return {entries:[],warnings:0,saveFailed:this.saveFailed};throw new Error('History unavailable.');}
          if(method==='history.list'&&!args.length){const list=await this.history.list(this.activeId());list.saveFailed=this.saveFailed;return list;}
          if(typeof args[0]!=='string'||!HISTORY_ID.test(args[0]))throw new Error('Invalid history selection.');
          if(method==='history.get'&&args.length===1)return this.history.get(args[0],this.activeId());
          if(method==='history.rename'&&args.length===2&&validHistoryName(args[1])){
            const id=args[0],name=args[1];return this.serial(async()=>{
              const entry=await this.history!.rename(id,name,this.activeId());if(entry.id===this.currentId)this.saved=entry;return entry;
            });
          }
          if(method==='history.delete'&&args.length===1){const id=args[0];return this.serial(async()=>{
            await this.history!.delete(id,this.activeId());
            if(id===this.currentId){this.skipArchiveCurrent=true;this.saved=null;this.currentId=null;}return null;
          });}
          throw new Error('Unsupported history operation.');
        }
        if(panel==='runtime'){
          if(!['status','start','stop','clear'].includes(method)||args.length>(method==='start'?1:0))throw new Error('Unsupported context meter request.');
          if(method==='status'){
            return this.status();
          }
          if(method==='stop')return this.serial(async()=>{this.stopTimer();await this.observer.stop();await this.checkpoint().catch(()=>{});return this.status();});
          if(method==='clear')return this.serial(async()=>{
            if(this.activeId())throw new Error('Stop observation before clearing.');
            await this.checkpoint();await this.observer.clear();this.currentId=null;this.saved=null;this.saveFailed=false;this.skipArchiveCurrent=false;return this.status();
          });
          if(!this.started||this.stopped||(!this.options.dataDir&&!this.options.observer))throw new Error(zh?'请先在 World 总览启用本扩展。':'Enable this extension in Worlds first.');
          const profile=args.length?args[0]:this.options.cfg.profile;
          if(!isProfile(profile))throw new Error('Unsupported tokenizer profile.');
          return this.serial(async()=>{try{
            const alreadyActive=!!this.activeId();
            if(!alreadyActive)await this.checkpoint();
            const report=await this.observer.start(profile);
            if(!alreadyActive){this.currentId=randomUUID();this.saved=null;this.skipArchiveCurrent=false;await this.checkpoint().catch(()=>{});this.startTimer();}
            if(!this.stopped&&profile!==this.options.cfg.profile)this.options.persist(profile);
            return this.status();
          }catch{throw new Error(zh?'无法开始新观察，请检查安装或历史保存状态；原结果仍保留。':'Cannot start a new observation. Check installation or history storage; previous results are retained.');}});
        }
        if (panel!=='overview' || method!=='scan' || args.length>1) throw new Error('Unsupported context meter request.');
        if (this.stopped) throw new Error(zh?'扩展已停用。':'The extension is stopped.');
        const profile=args.length ? args[0] : this.options.cfg.profile;
        if (!isProfile(profile)) throw new Error(zh?'请选择受支持的分词器。':'Choose a supported tokenizer.');
        if (this.pending) throw new Error(zh?'正在统计，请稍候。':'A scan is already running.');
        this.pending=(async()=>{
          let count:CountTokens;
          try { count=await (this.options.counter ?? loadCounter)(profile); }
          catch { throw new Error(zh?'随包分词器不可用，请重新安装完整扩展。':'Bundled tokenizer unavailable. Reinstall the complete extension.'); }
          const report=await scan({directory:this.options.directory,profile,count});
          this.lastScan=report;
          if(!this.stopped && profile!==this.options.cfg.profile) this.options.persist(profile);
          return report;
        })();
        try { return await this.pending; } finally { this.pending=null; }
      },
    };
  }
}
