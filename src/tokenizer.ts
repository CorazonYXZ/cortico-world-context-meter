import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Tokenizer } from '@huggingface/tokenizers';
import type { CountTokens } from './estimate.ts';
import { isProfile, type Profile } from './types.ts';
const hashes:Record<Profile,string>={
  v41:'81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99',
  v4:'97d2f31b020d18b5aee5c9b3d5b4efb10ea210f3fe3f7dffe3f1cd90542d6b19',
};
const cache=new Map<Profile,Promise<CountTokens>>();
/** No Hub client or model loader: only these fixed bundled files can be opened. */
export function loadCounter(profile:Profile):Promise<CountTokens> {
  if (!isProfile(profile)) return Promise.reject(new Error('Unsupported tokenizer profile.'));
  let pending=cache.get(profile);
  if (!pending) {
    pending=(async()=>{
      const bytes=await readFile(new URL('../assets/tokenizers/'+profile+'/tokenizer.json',import.meta.url));
      if(createHash('sha256').update(bytes).digest('hex')!==hashes[profile]) throw new Error('Bundled tokenizer checksum mismatch.');
      const tokenizer=new Tokenizer(JSON.parse(bytes.toString('utf8')),{});
      return (text:string)=>tokenizer.encode(text,{add_special_tokens:false}).ids.length;
    })();
    cache.set(profile,pending);
    pending.catch(()=>cache.delete(profile));
  }
  return pending;
}
