import type { ExtensionEstimate, ExtensionKind, Issue } from './types.ts';
export type CountTokens = (text: string) => number;
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);

/** Sort JSON object keys, preserving arrays. Only the selected wire-like fields enter the count. */
export function canonicalJson(value: unknown): string {
  function sorted(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sorted);
    if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(key => [key, sorted(v[key])]));
    return v;
  }
  return JSON.stringify(sorted(value));
}
export function unavailable(name: string, kind: ExtensionKind, issue: Issue): ExtensionEstimate {
  return { name, kind, status:'unavailable', toolCount:null, toolTokens:null, promptTokens:null, totalTokens:null, share:null, issues:[issue] };
}
export function estimate(name: string, kind: ExtensionKind, description: unknown, count: CountTokens): ExtensionEstimate {
  if (!object(description)) return unavailable(name,kind,'description_unreadable');
  const issues = new Set<Issue>();
  let toolTokens: number | null = null;
  let promptTokens: number | null = null;
  let toolCount: number | null = null;
  const providerWithoutContext = kind === 'provider' && !own(description,'tools') && !own(description,'prompts');
  if (providerWithoutContext) {
    if (!object(description.provider)) return unavailable(name,kind,'description_unreadable');
    return { name,kind,status:'not_applicable',toolCount:null,toolTokens:null,promptTokens:null,totalTokens:null,share:null,issues:[] };
  }
  if (Array.isArray(description.tools)) {
    const tools = new Map<string, {json:string; value:Record<string,unknown>} | null>();
    for (const item of description.tools) {
      if (!object(item) || typeof item.name !== 'string' || !item.name || typeof item.description !== 'string' || !object(item.parameters)) {
        issues.add('invalid_tool'); continue;
      }
      const value = { name:item.name, description:item.description, parameters:item.parameters };
      const json = canonicalJson(value);
      if (tools.has(item.name)) {
        if (tools.get(item.name)?.json === json) issues.add('duplicate_tool');
        else { tools.set(item.name,null); issues.add('conflicting_tool'); }
      } else tools.set(item.name,{json,value});
    }
    const selected = [...tools.entries()].sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).flatMap(([,v])=>v ? [v.value] : []);
    toolCount = selected.length || description.tools.length === 0 ? selected.length : null;
    // Invalid-only sections are unknown, not an apparent zero.
    if (selected.length || description.tools.length === 0) toolTokens = selected.length ? count(canonicalJson(selected)) : 0;
  } else issues.add('invalid_tools');

  if (!own(description,'prompts')) promptTokens=0; // The exporter omits an empty list.
  else if (Array.isArray(description.prompts)) {
    const prompts = new Map<string,string | null>();
    for (const item of description.prompts) {
      if (!object(item) || typeof item.key !== 'string' || !item.key || typeof item.content !== 'string'
        || (item.role !== undefined && item.role !== 'prefix' && item.role !== 'envPrompt')) {
        issues.add('invalid_prompt'); continue;
      }
      if (prompts.has(item.key)) {
        if (prompts.get(item.key) === item.content) issues.add('duplicate_prompt');
        else { prompts.set(item.key,null); issues.add('conflicting_prompt'); }
      } else prompts.set(item.key,item.content);
    }
    const valid = [...prompts.values()].filter((v):v is string=>v !== null);
    if (valid.length || description.prompts.length === 0) promptTokens=valid.reduce((sum,text)=>sum+count(text),0);
  } else issues.add('invalid_prompts');

  const hasKnown = toolTokens !== null || (own(description,'prompts') && promptTokens !== null);
  const totalTokens = hasKnown ? (toolTokens ?? 0)+(promptTokens ?? 0) : null;
  return { name,kind,status:!hasKnown ? 'unavailable' : issues.size ? 'partial' : 'complete',toolCount,toolTokens,promptTokens,totalTokens,share:null,issues:[...issues] };
}
