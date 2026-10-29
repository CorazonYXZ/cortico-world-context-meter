export type SavedState='recording'|'stopped'|'interrupted';
export interface HistoryEntry {
  id:string;name:string;renamed:boolean;startedAt:string;endedAt:string|null;checkpointAt:string;retentionAt:string;
  status:SavedState;requests:number;totalTokens:number|null;incomplete:boolean;bytes:number;
}
export interface HistoryList {entries:HistoryEntry[];warnings:number;saveFailed:boolean;}
export interface Selection {id:string|null;name:string|null;status:SavedState|'off';checkpointAt:string|null;}
