import { useEffect, useState } from 'react'
import { appStorage } from '../state/editor'

/** An object URL for one of the photo's stored images, revoked when no longer shown. */
export function usePhotoUrl(photoId: string, variant: 'preview' | 'thumb'): string | null {
  const key = `${photoId}:${variant}`
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    appStorage()
      .getPhoto(photoId)
      .then((photo) => {
        if (cancelled || !photo) return
        url = URL.createObjectURL(photo[variant])
        setLoaded({ key: `${photoId}:${variant}`, url })
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId, variant])

  return loaded?.key === key ? loaded.url : null
}
