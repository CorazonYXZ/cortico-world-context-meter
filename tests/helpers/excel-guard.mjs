// Test-only guard: permits code-module reads, denies network, subprocesses and every output file.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import child from 'node:child_process';
import {parentPort} from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
// All library code is bundled. No node_modules or library data reads are permitted.
const allowed=new Set([fileURLToPath(new URL('../../dist/xlsx-export-worker.mjs',import.meta.url)),fileURLToPath(new URL('../../package.json',import.meta.url))].map(p=>resolve(p)));
const deny=operation=>(..._args)=>{parentPort.postMessage({test:'forbidden',operation});throw new Error('Forbidden Excel test operation');};
const check=value=>{const path=resolve(value instanceof URL?fileURLToPath(value):String(value));
  if(!allowed.has(path))deny('file-read')();parentPort.postMessage({test:'module-read'});};
for(const target of [fs,promises]){
  for(const name of ['readFile','readFileSync'])if(typeof target[name]==='function'){
    const original=target[name];target[name]=function(path,...args){check(path);return original.call(this,path,...args);};
  }
  for(const name of ['writeFile','writeFileSync','appendFile','appendFileSync','createWriteStream','write','writeSync','rename','renameSync','unlink','unlinkSync','rm','rmSync','mkdir','mkdirSync'])
    if(typeof target[name]==='function')target[name]=deny('file-write');
  for(const name of ['open','openSync'])if(typeof target[name]==='function'){
    const original=target[name];target[name]=function(path,flag,...args){check(path);if(flag!=='r'&&flag!==0)deny('file-write')();return original.call(this,path,flag,...args);};
  }
}
globalThis.fetch=deny('fetch');
for(const target of [http,https])for(const method of ['request','get'])target[method]=deny('http');
for(const target of [net,tls])for(const method of ['connect','createConnection'])if(target[method])target[method]=deny('socket');
for(const method of ['spawn','exec','execFile','fork','spawnSync','execSync','execFileSync'])if(child[method])child[method]=deny('subprocess');
syncBuiltinESMExports();parentPort.postMessage({test:'guard-ready'});
