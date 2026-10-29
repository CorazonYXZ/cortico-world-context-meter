import { describe,it,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Tokenizer } from '@huggingface/tokenizers';
import { loadCounter } from '../src/tokenizer.ts';
import type { Profile } from '../src/types.ts';
import reference from './fixtures/tokenizer-reference.json';

describe('bundled offline tokenizers',()=>{
  for(const profile of ['v41','v4'] as const) {
    it(`${profile} matches fixed public Rust tokenizer reference IDs and counts`,async()=>{
      const count=await loadCounter(profile);
      const tokenizer=new Tokenizer(JSON.parse(await readFile(new URL(`../assets/tokenizers/${profile}/tokenizer.json`,import.meta.url),'utf8')),{});
      for(const sample of reference.profiles[profile]) {
        expect(tokenizer.encode(sample.text,{add_special_tokens:false}).ids).toEqual(sample.ids);
        expect(count(sample.text)).toBe(sample.count);
      }
      expect(await loadCounter(profile)).toBe(count);
    });
  }
  it('rejects arbitrary file names before file access',async()=>{
    await expect(loadCounter('../secret' as Profile)).rejects.toThrow('Unsupported tokenizer profile');
  });
});
