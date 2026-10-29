export const PROFILES = ['v41', 'v4'] as const;
export type Profile = (typeof PROFILES)[number];
export type ExtensionKind = 'world' | 'provider' | 'bot' | 'unknown';
export type Status = 'complete' | 'partial' | 'unavailable' | 'not_applicable';
export type Issue = 'manifest_unreadable' | 'invalid_manifest' | 'missing_description' | 'description_unreadable'
  | 'unsafe_path' | 'oversized_file' | 'invalid_tools' | 'invalid_tool' | 'duplicate_tool'
  | 'conflicting_tool' | 'invalid_prompts' | 'invalid_prompt' | 'duplicate_prompt' | 'conflicting_prompt';
export interface ExtensionEstimate {
  name: string;
  kind: ExtensionKind;
  status: Status;
  toolCount: number | null;
  toolTokens: number | null;
  promptTokens: number | null;
  totalTokens: number | null;
  share: number | null;
  issues: Issue[];
}
export interface ScanReport {
  profile: Profile;
  estimatedAt: string;
  rows: ExtensionEstimate[];
  measuredTokens: number;
  completeCount: number;
  partialCount: number;
  unavailableCount: number;
  directoryStatus: 'ok' | 'missing' | 'unreadable';
}
export function isProfile(value: unknown): value is Profile {
  return value === 'v41' || value === 'v4';
}
