import { useCallback, useEffect, useState } from 'react'
import type { Frame } from '../core/types'
import { appStorage, useEditor } from '../state/editor'

/**
 * The photo ids used by these frames that storage no longer has. Asks storage itself: the
 * editor state can remember a photo that is gone. `missing` is null until storage has answered.
 */
export function useMissingPhotos(frames: Frame[]): {
  missing: Set<string> | null
  recheck: () => void
} {
  // A photo imported again arrives through the editor state, under the same id.
  const photos = useEditor((s) => s.photos)
  const key = [...new Set(frames.flatMap((f) => f.layers.map((l) => l.photoId)))].sort().join(' ')
  const [answer, setAnswer] = useState<{ key: string; missing: Set<string> } | null>(null)
  const [checks, setChecks] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ids = key === '' ? [] : key.split(' ')
    appStorage()
      .getPhotosMeta(ids)
      .then((known) => {
        if (!cancelled) setAnswer({ key, missing: new Set(ids.filter((id) => !known[id])) })
      })
      .catch((e: unknown) => {
        // Generating checks again and reports the problem to the person.
        console.error(e)
        if (!cancelled) setAnswer({ key, missing: new Set() })
      })
    return () => {
      cancelled = true
    }
  }, [key, photos, checks])

  const recheck = useCallback(() => setChecks((n) => n + 1), [])
  return { missing: answer?.key === key ? answer.missing : null, recheck }
}
