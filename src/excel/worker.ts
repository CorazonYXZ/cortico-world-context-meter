import {parentPort,workerData} from 'node:worker_threads';
import {xlsxBuffer} from './xlsx.ts';
if(!parentPort)throw new Error('E_XLSX_START');
const port=parentPort;
port.postMessage({type:'started'});
try{
  const bytes=await xlsxBuffer(workerData.report,workerData.language);
  port.postMessage({type:'result',bytes},[bytes]);
}catch{port.postMessage({type:'failed'});}
finally{port.close();}
