import { useEffect, useState } from 'react'
import { appStorage } from '../state/editor'
import { useSyncStatus } from './status'
import { syncNow } from './useSync'

/** True while the account syncs with the Drive: the per-collection Drive controls show then. */
export function useDriveOn(): boolean {
  return useSyncStatus((s) => s.state !== 'off' && s.state !== 'needsDrive')
}

/** Removes the collection from the Drive (or sends it back) and starts a pass for it. */
export async function setCollectionLocalOnly(id: string, localOnly: boolean): Promise<void> {
  await appStorage().setLocalOnly(id, localOnly)
  // The pass runs in the background: it must not hold the screen.
  void syncNow()
}

/** Whether the stored collection is kept off the Drive; read again when `version` changes. */
export function useStoredLocalOnly(id: string, version: number): boolean {
  const [localOnly, setLocalOnly] = useState(false)
  useEffect(() => {
    let current = true
    appStorage()
      .listCollections()
      .then((list) => {
        if (current) setLocalOnly(list.find((c) => c.id === id)?.localOnly === true)
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      current = false
    }
  }, [id, version])
  return localOnly
}
