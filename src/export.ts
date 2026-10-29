import pkg from '../package.json' with {type:'json'};
import type {ScanReport} from './types.ts';
import type {Meters,RuntimeReport} from './runtime/types.ts';
import type {Selection} from './history-types.ts';

const issueKeys=['missing_source','unreadable_source','unsafe_path','source_changed','oversized_record','invalid_record',
  'unmatched_result','missing_meter','conflicting_record','retention_limit','worker_failed','stop_incomplete'] as const;

const meters=(m:Meters)=>({input:m.input,output:m.output,cachedInput:m.cachedInput,uncachedInput:m.uncachedInput,reasoning:m.reasoning});
const total=(m:Meters)=>m.input===null||m.output===null||!Number.isSafeInteger(m.input+m.output)?null:m.input+m.output;

/** Explicit metadata allowlist: never serialize an arbitrary report or upstream record. */
export function createExport(scan:ScanReport|null,runtime:RuntimeReport,now=new Date(),selection?:Selection) {
  const included=runtime.requests.filter(r=>r.basis==='provider'&&!r.boundary);
  return {
    schemaVersion:1,
    extension:{package:pkg.name,id:'context-meter',displayName:'token计数',version:pkg.version},
    exportedAt:now.toISOString(),
    selection:selection??{id:null,name:null,status:runtime.state==='recording'||runtime.state==='starting'?'recording':runtime.state==='off'?'off':'stopped',checkpointAt:null},
    notes:[
      '包含当前窗口全部已留存统计，不受表格 200 行显示上限影响；不补读历史或尚未取得的记录。',
      '静态结果为最近一次成功统计；未统计时为 null。观察中导出是当前快照，不会停止采集。',
      '请求用量来自宿主记录，不是官网账单；总 token = 输入 + 输出，缓存和推理子项不重复相加。',
      '工具文本是本机参考分词估算，不加入请求总数，不代表该工具独立费用；图片实际 token 未知。',
      '仅窗口内供应商请求纳入汇总；跨边界及自报请求完整保留并分别标记。null 表示未知，已知合计可能不完整。',
      '请求、响应及调用标识已由采集器散列；文件仍含时间、模型和扩展使用信息，请自行决定是否分享。',
      'All retained metadata is exported, including unmatched records. No chat, bodies, arguments, file paths, URLs or keys are exported.',
    ],
    limits:{displayRows:200,retainedRecordsPerKind:10000,recordBytes:16*1024*1024},
    static:scan===null?null:{
      profile:scan.profile,estimatedAt:scan.estimatedAt,directoryStatus:scan.directoryStatus,
      measuredTokens:scan.measuredTokens,completeCount:scan.completeCount,partialCount:scan.partialCount,unavailableCount:scan.unavailableCount,
      rows:scan.rows.map(r=>({name:r.name,kind:r.kind,status:r.status,toolCount:r.toolCount,toolTokens:r.toolTokens,
        promptTokens:r.promptTokens,totalTokens:r.totalTokens,share:r.share,issues:r.issues.map(i=>i)})),
    },
    runtime:{
      state:runtime.state,profile:runtime.profile,startedAt:runtime.startedAt,endedAt:runtime.endedAt,updatedAt:runtime.updatedAt,
      durationMs:runtime.durationMs,run:runtime.run,truncated:runtime.truncated,
      sources:{usage:runtime.sources.usage,index:runtime.sources.index,tools:runtime.sources.tools,transcript:runtime.sources.transcript},
      issues:Object.fromEntries(issueKeys.filter(key=>typeof runtime.issues[key]==='number').map(key=>[key,runtime.issues[key]])),
      totals:{...meters(runtime.totals),totalTokens:total(runtime.totals),providerRequests:runtime.totals.providerRequests,
        reportedRecords:runtime.totals.reportedRecords,boundaryRequests:runtime.totals.boundaryRequests,
        toolCalls:runtime.totals.toolCalls,boundaryTools:runtime.totals.boundaryTools},
      meterCoverage:Object.fromEntries((['input','output','cachedInput','uncachedInput','reasoning'] as const)
        .map(key=>[key,{known:included.filter(r=>r[key]!==null).length,unknown:included.filter(r=>r[key]===null).length}])),
      requests:runtime.requests.map(r=>({id:r.id,run:r.run,round:r.round,responseId:r.responseId,role:r.role,model:r.model,
        at:r.at,startedAt:r.startedAt,durationMs:r.durationMs,outcome:r.outcome,basis:r.basis,boundary:r.boundary,
        ...meters(r),totalTokens:total(r),tools:r.tools.map(id=>id)})),
      tools:runtime.tools.map(t=>({id:t.id,run:t.run,round:t.round,responseId:t.responseId,callId:t.callId,
        at:t.at,startedAt:t.startedAt,tool:t.tool,owner:t.owner,role:t.role,durationMs:t.durationMs,failed:t.failed,
        boundary:t.boundary,textTokens:t.textTokens,textBasis:t.textBasis,imageCount:t.imageCount,imageTokens:t.imageTokens,
        flashImageUpperBound:t.flashImageUpperBound})),
      groups:runtime.groups.map(g=>({owner:g.owner,calls:g.calls,perMinute:g.perMinute,durationMs:g.durationMs,failures:g.failures,
        textTokens:g.textTokens,measuredTexts:g.measuredTexts,unknownTexts:g.unknownTexts,imageCount:g.imageCount})),
    },
  };
}
export type StatisticsExport=ReturnType<typeof createExport>;
