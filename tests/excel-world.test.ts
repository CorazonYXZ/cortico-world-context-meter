import {afterEach,describe,it,expect,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {ContextMeterWorld} from '../src/world.ts';
import type {BinaryExport} from '../src/excel/controller.ts';
import {ExcelExporter} from '../src/excel/controller.ts';
import type {HistoryList} from '../src/history-types.ts';
import {demoReport} from './helpers/runtime-report.ts';
import {fixture} from './helpers/fixture.ts';
const fList:Awaited<ReturnType<typeof fixture>>[]=[],worlds:ContextMeterWorld[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const w of worlds)await w.stop();worlds.length=0;for(const f of fList)await f.cleanup();fList.length=0;});
const owner='11111111-1111-4111-8111-111111111111';
async function setup(){const f=await fixture();fList.push(f);const report=demoReport(205);Object.assign(report.requests[0],{body:'PRIVATE_BODY',arguments:'PRIVATE_ARGS'});
  await f.add('cortico-world-public','world',{tools:[],prompts:[{key:'public',content:'PUBLIC_TEMPLATE'}]});
  const observer={status:()=>structuredClone(report),stop:async()=>structuredClone(report),start:async()=>structuredClone(report),clear:async()=>structuredClone(report)};
  const world=new ContextMeterWorld({cfg:{enabled:false,profile:'v41'},dataDir:f.base,directory:f.directory,persist:vi.fn(),observer,counter:async()=>s=>s.length});worlds.push(world);
  return {world,invoke:world.webUi().invoke!,observer};}
describe('World binary export data plane',()=>{
  it('exports the current and selected saved snapshots through the binary envelope without exposing bodies',async()=>{
    const {invoke}=await setup();await invoke('overview','scan',[]);await invoke('runtime','stop',[]);
    const list=await invoke('runtime','history.list',[]) as HistoryList;expect(list.entries).toHaveLength(1);
    for(const id of [null,list.entries[0].id]){
      const binary=await invoke('runtime','export.xlsx',[id,'zh',owner]) as BinaryExport;
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(new Uint8Array(Buffer.from(binary.$binary.base64,'base64')).buffer);
      expect(workbook.getWorksheet('模型请求')!.rowCount).toBe(206);expect(workbook.getWorksheet('静态排行')!.rowCount).toBe(2);
      expect(JSON.stringify(workbook.model)).not.toContain('PRIVATE_');expect(JSON.stringify(workbook.model)).not.toContain('PUBLIC_TEMPLATE');
    }
  });
  it('rejects paths, wrong languages, ownership ids and argument counts before any worker starts',async()=>{
    const {invoke}=await setup(),generate=vi.spyOn(ExcelExporter.prototype,'generate');
    for(const args of [[],['../private','zh',owner],[null,'invalid',owner],[null,'zh','private'],[null,'zh',owner,'extra']])
      await expect(invoke('runtime','export.xlsx',args)).rejects.toThrow('E_EXPORT_ARGS');
    await expect(invoke('runtime','export.cancel',['../private'])).rejects.toThrow('E_EXPORT_ARGS');expect(generate).not.toHaveBeenCalled();
    expect(await invoke('runtime','export.cancel',[owner])).toBe(false);
  });
  it('disposes exports on World stop and supports reactivation without changing the observer',async()=>{
    const {world,invoke,observer}=await setup(),dispose=vi.spyOn(ExcelExporter.prototype,'dispose');
    const before=observer.status();await world.stop();expect(dispose).toHaveBeenCalledTimes(1);
    await expect(invoke('runtime','export.xlsx',[null,'zh',owner])).rejects.toThrow('E_XLSX_UNAVAILABLE');
    await world.start({} as never);const binary=await invoke('runtime','export.xlsx',[null,'zh',owner]) as BinaryExport;expect(binary.$binary.base64).toBeTruthy();
    expect(observer.status()).toEqual(before);
  });
});
