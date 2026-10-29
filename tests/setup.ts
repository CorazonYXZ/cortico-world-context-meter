import { afterEach, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
// Tests run offline even when the surrounding process has network access.
const blocked=()=>{throw new Error('Network and subprocesses are forbidden in runtime tests.');};
vi.stubGlobal('fetch',vi.fn(blocked));
for(const module of [http,https]) {
  vi.spyOn(module,'request').mockImplementation(blocked);
  vi.spyOn(module,'get').mockImplementation(blocked);
}
vi.spyOn(net,'connect').mockImplementation(blocked);
vi.spyOn(net,'createConnection').mockImplementation(blocked);
vi.spyOn(childProcess,'spawn').mockImplementation(blocked);
vi.spyOn(childProcess,'exec').mockImplementation(blocked);
afterEach(()=>{vi.clearAllMocks();});
