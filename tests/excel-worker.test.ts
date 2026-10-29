import {describe,it,expect} from 'vitest';
import {Worker} from 'node:worker_threads';
import ExcelJS from 'exceljs';
import {createExport} from '../src/export.ts';
import {demoReport} from './helpers/runtime-report.ts';
describe('actual guarded Excel worker',()=>{
  it('creates workbook bytes from metadata without network, output files, private reads or body logs',async()=>{
    const report=createExport(null,demoReport(3));const messages:any[]=[];let printed='';
    const worker=new Worker(new URL('../dist/xlsx-export-worker.mjs',import.meta.url),{
      workerData:{report,language:'zh'},execArgv:['--import',new URL('./helpers/excel-guard.mjs',import.meta.url).href],stdout:true,stderr:true});
    worker.stdout?.on('data',value=>{printed+=value;});worker.stderr?.on('data',value=>{printed+=value;});
    try{
      const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{
        worker.on('message',message=>{messages.push(message);if(message.type==='result')resolve(message.bytes);if(message.type==='failed')reject(new Error('Guarded generation failed'));});
        worker.on('error',()=>reject(new Error('Guarded worker failed')));
        worker.on('exit',()=>{if(!messages.some(m=>m.type==='result'))reject(new Error('Missing Excel output'));});
      });
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);expect(workbook.worksheets).toHaveLength(6);
      expect(messages.some(m=>m.test==='guard-ready')).toBe(true);expect(messages.filter(m=>m.test==='forbidden')).toEqual([]);expect(printed).toBe('');
    }finally{await worker.terminate();}
  });
});
