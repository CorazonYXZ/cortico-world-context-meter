import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {parentPort,workerData} from 'node:worker_threads';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(workerData.dataDir);
const tokenizer=resolve(import.meta.dirname,'../../assets/tokenizers',workerData.profile,'tokenizer.json');
const modules=new Set([resolve(import.meta.dirname,'../../dist/observer-worker.mjs'),fileURLToPath(import.meta.resolve('@huggingface/tokenizers'))]);
const allowed=path=>{
  const full=resolve(path instanceof URL?fileURLToPath(path):String(path));
  const relative=full.slice(root.length+1).replaceAll('\\','/');
  return modules.has(full)||full===tokenizer || full.startsWith(root+'\\')&&/^(usage\.jsonl|runs\/index\.jsonl|runs\/r-\d{8}-\d{6}-[a-f0-9]{4}\/(toolcalls|transcript)\.jsonl)$/.test(relative)
    || full.startsWith(root+'/')&&/^(usage\.jsonl|runs\/index\.jsonl|runs\/r-\d{8}-\d{6}-[a-f0-9]{4}\/(toolcalls|transcript)\.jsonl)$/.test(relative);
};
function denied(action){parentPort.postMessage({test:'forbidden',action});throw new Error('Forbidden in offline worker test.');}
const open=fs.open.bind(fs),readFile=fs.readFile.bind(fs);
fs.open=async(path,...args)=>{
  if(!allowed(path))return denied('file');
  parentPort.postMessage({test:'read',path:String(path)});return open(path,...args);
};
fs.readFile=async(path,...args)=>{
  if(!allowed(path))return denied('file');
  parentPort.postMessage({test:'read',path:String(path)});return readFile(path,...args);
};
const openSync=syncFs.openSync.bind(syncFs),readSync=syncFs.readFileSync.bind(syncFs);
// Node's ESM loader needs precisely the two executable modules, not arbitrary data files.
syncFs.openSync=(path,...args)=>modules.has(resolve(path instanceof URL?fileURLToPath(path):String(path)))?openSync(path,...args):denied('sync file');
syncFs.readFileSync=(path,...args)=>modules.has(resolve(path instanceof URL?fileURLToPath(path):String(path)))?readSync(path,...args):denied('sync file');
globalThis.fetch=(..._args)=>denied('fetch');
for(const module of [http,https]){module.request=(..._args)=>denied('http');module.get=(..._args)=>denied('http');}
net.connect=(..._args)=>denied('tcp');net.createConnection=(..._args)=>denied('tcp');tls.connect=(..._args)=>denied('tls');
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[key]=(..._args)=>denied('subprocess');
syncBuiltinESMExports();parentPort.postMessage({test:'guard-ready'});
