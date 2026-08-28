export type MinerUFileState = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed'
export type MinerUJobState = MinerUFileState | 'collecting' | 'partially-completed'
