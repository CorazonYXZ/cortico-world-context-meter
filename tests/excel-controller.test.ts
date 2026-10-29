import {afterEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {Worker,WorkerOptions} from 'node:worker_threads';
import ExcelJS from 'exceljs';
import {ExcelExporter} from '../src/excel/controller.ts';
import {createExport} from '../src/export.ts';
import {demoReport} from './helpers/runtime-report.ts';
const controllers:ExcelExporter[]=[];
afterEach(async()=>{for(const c of controllers)await c.dispose();controllers.length=0;});
const snapshot=async()=>createExport(null,demoReport(205));
class FakeWorker extends EventEmitter {
  stdout={resume:vi.fn()};stderr={resume:vi.fn()};terminate=vi.fn(async()=>0);
  result(){const bytes=new Uint8Array([80,75,3,4,0]).buffer;this.emit('message',{type:'result',bytes});}
}
function fake(timeoutMs=1000){const worker=new FakeWorker(),factory=vi.fn((_url:URL,_options:WorkerOptions)=>worker as unknown as Worker);
  const c=new ExcelExporter({timeoutMs,workerFactory:factory});controllers.push(c);return {c,worker,factory};}
describe('local Excel job lifecycle',()=>{
  it('runs the real built Node worker and returns a complete XLSX with no subset double counting',async()=>{
    const c=new ExcelExporter();controllers.push(c);const result=await c.generate('owner',snapshot,'zh');
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(new Uint8Array(Buffer.from(result.$binary.base64,'base64')).buffer);
    expect(workbook.worksheets).toHaveLength(6);expect(workbook.getWorksheet('模型请求')!.rowCount).toBe(206);
    expect(workbook.getWorksheet('模型请求')!.getRow(2).getCell(18).value).toBe(96023);
  });
  it('reserves the slot before asynchronous data reads, reports busy and only cancels its owner',async()=>{
    const {c,worker,factory}=fake();const first=c.generate('a',snapshot,'en');const firstError=first.catch(e=>e.message);
    await expect(c.generate('b',snapshot,'en')).rejects.toThrow('E_XLSX_BUSY');await vi.waitFor(()=>expect(factory).toHaveBeenCalledTimes(1));
    expect(factory.mock.calls[0][1]).toMatchObject({execArgv:[],stdout:true,stderr:true});
    expect(await c.cancel('b')).toBe(false);expect(worker.terminate).not.toHaveBeenCalled();
    expect(await c.cancel('a')).toBe(true);expect(await firstError).toBe('E_XLSX_CANCELLED');expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('does not start a worker if cancelled while the snapshot is still being prepared',async()=>{
    const {c,factory}=fake();let finish!:(value:Awaited<ReturnType<typeof snapshot>>)=>void;
    const result=c.generate('a',()=>new Promise(resolve=>{finish=resolve;}),'zh').catch(e=>e.message);
    await c.cancel('a');finish(await snapshot());await Promise.resolve();expect(await result).toBe('E_XLSX_CANCELLED');expect(factory).not.toHaveBeenCalled();
  });
  it('ignores a late-arriving export for a panel already unmounted without blocking a different panel',async()=>{
    const {c,worker,factory}=fake();expect(await c.cancel('closed-panel')).toBe(false);
    await expect(c.generate('closed-panel',snapshot,'en')).rejects.toThrow('E_XLSX_CANCELLED');expect(factory).not.toHaveBeenCalled();
    const result=c.generate('new-panel',snapshot,'en');await vi.waitFor(()=>expect(factory).toHaveBeenCalledTimes(1));worker.result();await result;
  });
  it('waits for successful worker termination before releasing the slot',async()=>{
    const {c,worker,factory}=fake();let release!:(value:number)=>void;worker.terminate.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const result=c.generate('a',snapshot,'en');await vi.waitFor(()=>expect(factory).toHaveBeenCalledTimes(1));worker.result();
    await expect(c.generate('b',snapshot,'en')).rejects.toThrow('E_XLSX_BUSY');release(0);expect((await result).$binary.base64).toBeTruthy();
    const next=c.generate('b',snapshot,'en');await vi.waitFor(()=>expect(factory).toHaveBeenCalledTimes(2));worker.result();await next;
  });
  it('terminates on timeout, disposes on stop and can resume without leaking a pending job',async()=>{
    const {c,worker}=fake(30);await expect(c.generate('a',snapshot,'zh')).rejects.toThrow('E_XLSX_TIMEOUT');expect(worker.terminate).toHaveBeenCalledTimes(1);
    await c.dispose();await expect(c.generate('a',snapshot,'zh')).rejects.toThrow('E_XLSX_UNAVAILABLE');c.resume();
    const error=c.generate('a',snapshot,'zh').catch(e=>e.message);await c.dispose();expect(await error).toBe('E_XLSX_CANCELLED');
  });
  it('returns fixed data, startup and generation codes without private error details',async()=>{
    const {c,worker,factory}=fake();await expect(c.generate('a',async()=>{throw new Error('PRIVATE_DATA');},'zh')).rejects.toThrow(/^E_EXPORT_DATA$/);
    factory.mockImplementationOnce(()=>{throw new Error('PRIVATE_PATH');});await expect(c.generate('a',snapshot,'zh')).rejects.toThrow(/^E_XLSX_START$/);
    const failed=c.generate('a',snapshot,'zh');const assertion=expect(failed).rejects.toThrow(/^E_XLSX_GENERATE$/);
    await vi.waitFor(()=>expect(factory).toHaveBeenCalledTimes(2));worker.emit('message',{type:'started'});worker.emit('error',new Error('PRIVATE_BODY'));await assertion;
  });
});
