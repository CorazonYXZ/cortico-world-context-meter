import {parentPort,workerData} from 'node:worker_threads';
import {loadCounter} from '../tokenizer.ts';
import {isProfile} from '../types.ts';
import {ObservationSession} from './session.ts';
// Both src/tokenizer.ts and this bundle in dist sit one level below the package root.
if(!parentPort)throw new Error('Observer requires a worker.');
const port=parentPort;
let timer:ReturnType<typeof setTimeout>|undefined;
let closing=false;
let session:ObservationSession|undefined;
const fail=()=>{port.postMessage({type:'failed'});port.close();};
if(!workerData||typeof workerData.dataDir!=='string'||!isProfile(workerData.profile)||!Number.isSafeInteger(workerData.pid))fail();
else{
  session=new ObservationSession({dataDir:workerData.dataDir,profile:workerData.profile,pid:workerData.pid,
    counter:()=>loadCounter(workerData.profile)});
  const current=session;
  const tick=async()=>{
    if(closing)return;
    try{const report=await current.poll();if(!closing)port.postMessage({type:'report',report});}
    catch{if(!closing){closing=true;fail();}return;}
    if(!closing)timer=setTimeout(()=>{void tick();},1000);
  };
  port.on('message',async message=>{
    if(message?.type!=='stop'||closing)return;
    closing=true;if(timer)clearTimeout(timer);
    try{const report=await current.stop();port.postMessage({type:'report',report});port.close();}
    catch{fail();}
  });
  try{
    const report=await current.start();
    if(!closing){port.postMessage({type:'report',report});timer=setTimeout(()=>{void tick();},1000);}
  }catch{closing=true;fail();}
}
