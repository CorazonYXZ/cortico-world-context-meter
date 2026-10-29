import { open, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Issue } from './types.ts';

export class FileProblem extends Error {
  constructor(readonly issue: Issue) { super(issue); }
}
export function contained(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}
export interface DeclarationReader {
  canonical(path: string): Promise<string>;
  readJson(path: string, limit: number): Promise<unknown>;
}
/** Only explicitly nominated JSON files are read; never returns parser text in an error. */
export function declarationReader(onRead?: (path: string) => void): DeclarationReader {
  return {
    canonical: realpath,
    async readJson(path, limit) {
      if (extname(path).toLowerCase() !== '.json') throw new FileProblem('unsafe_path');
      const file = await open(path, 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new FileProblem('unsafe_path');
        if (stat.size > limit) throw new FileProblem('oversized_file');
        // A bounded read also limits growth between stat() and read().
        const bytes = Buffer.alloc(limit + 1);
        let used = 0;
        while (used < bytes.length) {
          const chunk = await file.read(bytes, used, bytes.length - used, used);
          if (!chunk.bytesRead) break;
          used += chunk.bytesRead;
        }
        if (used > limit) throw new FileProblem('oversized_file');
        onRead?.(path);
        try { return JSON.parse(bytes.subarray(0, used).toString('utf8').replace(/^\uFEFF/, '')); }
        catch { throw new FileProblem('description_unreadable'); }
      } finally { await file.close(); }
    },
  };
}
/** Package-directory links are supported; a declaration escaping that real directory is rejected. */
export async function packageJsonPath(reader: DeclarationReader, root: string, declared: string): Promise<string> {
  if (!declared || isAbsolute(declared) || /[\\:\0]/.test(declared) || /(^|\/)\.\.(\/|$)/.test(declared)) throw new FileProblem('unsafe_path');
  const candidate = resolve(root, declared);
  if (!contained(root, candidate) || extname(candidate).toLowerCase() !== '.json') throw new FileProblem('unsafe_path');
  const canonical = await reader.canonical(candidate);
  if (!contained(root, canonical) || extname(canonical).toLowerCase() !== '.json') throw new FileProblem('unsafe_path');
  return canonical;
}
