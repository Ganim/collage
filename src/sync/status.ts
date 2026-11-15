import { create } from 'zustand'

export interface SyncStatus {
  state: 'off' | 'needsDrive' | 'idle' | 'syncing' | 'offline' | 'error'
  error?: 'full' | 'revoked' | 'other'
  lastSyncedAt?: number
  photos?: { done: number; total: number }
  /** Bumps whenever the sync changed local data. */
  changeCount: number
  /** Collections pulled, copied or deleted by the last run, or whose photos came down. */
  changedIds: string[]
}

export const useSyncStatus = create<SyncStatus>()(() => ({
  state: 'off',
  changeCount: 0,
  changedIds: [],
}))
