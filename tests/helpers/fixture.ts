import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, sep} from 'node:path';
export async function fixture() {
  const base=await mkdtemp(join(tmpdir(),'context-meter-test-'));
  const directory=join(base,'extensions');
  const dependencies:Record<string,string>={};
  async function json(path:string,value:unknown) {await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value));}
  async function manifest() {await json(join(directory,'package.json'),{dependencies});}
  await manifest();
  return {base,directory,json,manifest,dependencies,
    async add(name:string,kind='world',description:unknown={tools:[]},declared:unknown='describe.json') {
      dependencies[name]='link:fixture';await manifest();
      const root=join(directory,'node_modules',...name.split('/'));
      await json(join(root,'package.json'),{name,type:'module',main:'index.mjs',cortico:{kind,api:6,describe:declared}});
      if(declared==='describe.json') await json(join(root,'describe.json'),description);
      // Importing this entry is both unnecessary and a privacy regression.
      await writeFile(join(root,'index.mjs'),'throw new Error("Other extension executed!");');
      await writeFile(join(root,'.env'),'FAKE_PRIVATE_API_KEY=must-not-be-read');
      await mkdir(join(root,'memory'),{recursive:true});
      await writeFile(join(root,'memory','MEMORY.md'),'FAKE_PRIVATE_CHAT');
      return root;
    },
    async cleanup(){
      const target=resolve(base);const parent=resolve(tmpdir());
      if(!target.startsWith(parent+sep) || !target.slice(parent.length+1).startsWith('context-meter-test-')) throw new Error('Unsafe fixture cleanup');
      await rm(target,{recursive:true,force:true});
    },
  };
}
