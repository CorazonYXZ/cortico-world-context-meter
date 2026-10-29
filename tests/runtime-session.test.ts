import {afterEach,describe,it,expect} from 'vitest';
import {appendFile,writeFile,rename,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {ObservationSession} from '../src/runtime/session.ts';
import {LogFiles,Tail,RECORD_LIMIT} from '../src/runtime/tail.ts';
import {NOW,iso,tool,result,usage,runtimeFixture} from './helpers/runtime-fixture.ts';
let fixtures:Awaited<ReturnType<typeof runtimeFixture>>[]=[];
afterEach(async()=>{for(const f of fixtures)await f.cleanup();fixtures=[];});
async function setup(){const f=await runtimeFixture();fixtures.push(f);return f;}
describe('incremental authorized log reads',()=>{
  it('starts from EOF, reads only four authorized logs, and stops all reads when off',async()=>{
    const f=await setup();await f.append('tools',tool('old'));await f.append('transcript',result('old','PRIVATE_OLD_HISTORY'));
    const reads:string[]=[];let now=NOW;
    const s=new ObservationSession({dataDir:f.dataDir,pid:process.pid,profile:'v41',now:()=>now,audit:p=>reads.push(p),counter:async()=>text=>{
      if(text.includes('PRIVATE_OLD_HISTORY'))throw new Error('History was reread');return text.length;
    }});
    const initial=await s.start();expect(initial.tools).toEqual([]);
    await f.append('tools',tool());await f.append('transcript',result('call-1','NEW_TEXT'));await f.append('usage',usage());now+=60000;
    const report=await s.poll();expect(report.tools).toHaveLength(1);expect(report.tools[0].textTokens).toBe(8);expect(report.totals.input).toBe(100);
    expect(reads.every(p=>Object.values(f.paths).includes(p))).toBe(true);
    await s.stop();const n=reads.length;await f.append('tools',tool('after'));await s.poll();expect(reads).toHaveLength(n);
    expect(JSON.stringify(s.snapshot())).not.toContain('PRIVATE_');
  });
  it('holds partial lines until complete and never joins a pre-existing partial record to new content',async()=>{
    const f=await setup();await writeFile(f.paths.tools,'{"OLD_PRIVATE":');
    const notes:string[]=[];const tail=new Tail(new LogFiles(f.dataDir),'runs/r-20261029-010000-a1b2/toolcalls.jsonl',n=>notes.push(n));
    await tail.baseline();await appendFile(f.paths.tools,'"secret"}\n{"new":');const rows:unknown[]=[];await tail.poll(v=>rows.push(v));expect(rows).toEqual([]);
    await appendFile(f.paths.tools,'1}\n');await tail.poll(v=>rows.push(v));expect(rows).toEqual([{new:1}]);expect(notes).toEqual([]);
  });
  it('rejects corrupt and oversized lines, recovers at the next newline, and keeps coverage notices',async()=>{
    const f=await setup();const notes:string[]=[];const tail=new Tail(new LogFiles(f.dataDir),'usage.jsonl',n=>notes.push(n));await tail.baseline();
    await appendFile(f.paths.usage,'{PRIVATE_BROKEN\n'+JSON.stringify({text:'x'.repeat(RECORD_LIMIT)})+'\n{"ok":1}\n');
    const rows:unknown[]=[];for(let i=0;i<6;i++)await tail.poll(v=>rows.push(v));
    expect(rows).toEqual([{ok:1}]);expect(notes).toContain('invalid_record');expect(notes).toContain('oversized_record');
  });
  it('does not replay replacement or truncated contents and resumes with subsequent new lines',async()=>{
    const f=await setup();await writeFile(f.paths.usage,'{"history":"long history"}\n');
    const notes:string[]=[];const rows:unknown[]=[];const tail=new Tail(new LogFiles(f.dataDir),'usage.jsonl',n=>notes.push(n));await tail.baseline();
    await writeFile(f.paths.usage,'{}\n');await tail.poll(v=>rows.push(v));expect(rows).toEqual([]);expect(notes).toContain('source_changed');
    await appendFile(f.paths.usage,'{"next":1}\n');await tail.poll(v=>rows.push(v));expect(rows).toEqual([{next:1}]);
  });
  it('rejects both escaping links and links to other private files inside the data directory',async()=>{
    const f=await setup();const inside=join(f.dataDir,'private');
    await rename(join(f.dataDir,'runs'),inside);
    await symlink(inside,join(f.dataDir,'runs'),process.platform==='win32'?'junction':'dir');
    const s=new ObservationSession({dataDir:f.dataDir,pid:process.pid,profile:'v41',counter:async()=>text=>text.length});
    const r=await s.start();expect(r.issues.unsafe_path).toBeGreaterThan(0);expect(r.run).toBeNull();
    const files=new LogFiles(f.dataDir);await expect(files.file('../.env')).rejects.toThrow('unsafe_path');
    await expect(files.file('session-main.jsonl')).rejects.toThrow('unsafe_path');await s.stop();
  });
  it('handles absent files that appear later without scanning other runs or old history',async()=>{
    const f=await setup();await rename(f.paths.usage,f.paths.usage+'.old');
    const s=new ObservationSession({dataDir:f.dataDir,pid:process.pid,profile:'v41',now:()=>NOW,counter:async()=>text=>text.length});
    expect((await s.start()).sources.usage).toBe('missing');await f.append('usage',usage());
    const r=await s.poll();expect(r.totals.providerRequests).toBe(1);expect(r.sources.usage).toBe('ready');await s.stop();
  });
  it('keeps malformed record text out of diagnostics and snapshots',async()=>{
    const f=await setup();const s=new ObservationSession({dataDir:f.dataDir,pid:process.pid,profile:'v41',now:()=>NOW,counter:async()=>text=>text.length});
    await s.start();await appendFile(f.paths.transcript,'{"PRIVATE_SENTINEL":\n');const r=await s.poll();
    expect(r.issues.invalid_record).toBe(1);expect(JSON.stringify(r)).not.toContain('PRIVATE_SENTINEL');await s.stop();
  });
  it('collects the final completed operation on stop without waiting for a timer; flags unfinished trailing records',async()=>{
    const f=await setup();let now=NOW;
    const s=new ObservationSession({dataDir:f.dataDir,pid:process.pid,profile:'v41',now:()=>now,counter:async()=>text=>text.length});
    await s.start();await f.append('tools',tool('last'));await f.append('transcript',result('last','last result'));
    await appendFile(f.paths.usage,'{"unfinished":');now+=1000;
    const r=await s.stop();expect(r.state).toBe('stopped');expect(r.tools[0].textTokens).toBe(11);
    expect(r.issues.stop_incomplete).toBe(1);
  });
});
