import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Collection, Photo } from '../core/types'
import type { Store, StoredPhoto } from './store'

interface BundledPhoto extends Photo {
  originalType: string
}

interface Manifest {
  collection: Collection
  photos: BundledPhoto[]
}

const PHOTO_ID = /^[0-9a-f]{64}$/
const MANIFEST = 'manifest.json'
const part = (id: string, kind: 'original' | 'preview' | 'thumb') => `photos/${id}/${kind}`

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** Builds a .collage file (zip) holding the collection and every photo it uses. */
export async function exportBundle(store: Store, collectionId: string): Promise<Blob> {
  const collection = await store.getCollection(collectionId)
  if (!collection) throw new Error('Collection not found')

  const files: Record<string, Uint8Array> = {}
  const photos: BundledPhoto[] = []
  for (const id of collection.photoIds) {
    const p = await store.getPhoto(id)
    if (!p) throw new Error(`Photo ${id} is missing from storage`)
    photos.push({
      id: p.id,
      width: p.width,
      height: p.height,
      name: p.name,
      originalType: p.original.type,
    })
    files[part(id, 'original')] = await bytes(p.original)
    files[part(id, 'preview')] = await bytes(p.preview)
    files[part(id, 'thumb')] = await bytes(p.thumb)
  }
  const manifest: Manifest = { collection, photos }
  files[MANIFEST] = strToU8(JSON.stringify(manifest))
  // Images are already compressed; storing is faster and no larger.
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' })
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function invalid(): never {
  throw new Error('Invalid collection file')
}

function validateCollection(c: unknown, photoIds: Set<string>): Collection {
  if (!isObj(c)) invalid()
  if (c.schemaVersion !== 1) throw new Error('Unsupported collection file version')
  const { name, frames, paper, updatedAt, photoIds: ids } = c
  if (!isStr(name) || !isNum(updatedAt) || !Array.isArray(frames) || !Array.isArray(ids)) invalid()
  if (!ids.every((id) => isStr(id) && photoIds.has(id))) invalid()
  if (!isObj(paper) || !['widthMm', 'heightMm', 'marginMm', 'gapMm'].every((k) => isNum(paper[k])))
    invalid()
  for (const f of frames) {
    if (
      !isObj(f) ||
      !isStr(f.id) ||
      !isNum(f.widthMm) ||
      !isNum(f.heightMm) ||
      !Array.isArray(f.layers)
    ) {
      invalid()
    }
    for (const l of f.layers) {
      if (
        !isObj(l) ||
        !isStr(l.id) ||
        !isStr(l.photoId) ||
        !ids.includes(l.photoId) ||
        !['cx', 'cy', 'widthFrac', 'rotationDeg'].every((k) => isNum(l[k]))
      ) {
        invalid()
      }
    }
  }
  return c as unknown as Collection
}

/**
 * Imports a .collage file under a new collection id. The whole file is parsed and
 * validated before anything is written.
 */
export async function importBundle(store: Store, file: Blob): Promise<Collection> {
  let files: Record<string, Uint8Array>
  let manifest: unknown
  try {
    files = unzipSync(await bytes(file))
    const raw = files[MANIFEST]
    if (!raw) invalid()
    manifest = JSON.parse(strFromU8(raw))
  } catch {
    throw new Error('Invalid collection file')
  }
  if (!isObj(manifest) || !Array.isArray(manifest.photos)) invalid()

  const bundled = new Map<string, BundledPhoto>()
  for (const p of manifest.photos) {
    if (
      !isObj(p) ||
      !isStr(p.id) ||
      !PHOTO_ID.test(p.id) ||
      !isNum(p.width) ||
      !isNum(p.height) ||
      !isStr(p.name) ||
      !isStr(p.originalType)
    ) {
      invalid()
    }
    for (const kind of ['original', 'preview', 'thumb'] as const) {
      if (!files[part(p.id, kind)]) invalid()
    }
    bundled.set(p.id, p as unknown as BundledPhoto)
  }
  const collection = validateCollection(manifest.collection, new Set(bundled.keys()))

  const photos: StoredPhoto[] = collection.photoIds.map((id) => {
    const p = bundled.get(id)!
    const blob = (kind: 'original' | 'preview' | 'thumb', type: string) =>
      new Blob([files[part(id, kind)] as BlobPart], { type })
    return {
      id,
      width: p.width,
      height: p.height,
      name: p.name,
      original: blob('original', p.originalType),
      preview: blob('preview', 'image/jpeg'),
      thumb: blob('thumb', 'image/jpeg'),
    }
  })

  for (const p of photos) await store.putPhoto(p)
  const imported: Collection = { ...collection, id: crypto.randomUUID() }
  await store.saveCollection(imported)
  return imported
}
