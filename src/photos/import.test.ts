// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createIdbStore } from '../storage/indexeddb'
import type { Store } from '../storage/store'
import { importPhotos, type Decode } from './import'

const decode: Decode = async (file) => {
  if (file.name.startsWith('bad')) throw new Error('cannot decode')
  return {
    width: 800,
    height: 600,
    preview: new Blob(['p'], { type: 'image/jpeg' }),
    thumb: new Blob(['t'], { type: 'image/jpeg' }),
  }
}

let n = 0
let store: Store
beforeEach(async () => {
  store = await createIdbStore(`import-${n++}`)
})

const file = (content: string, name: string) => new File([content], name, { type: 'image/jpeg' })

describe('importPhotos', () => {
  it('turns the same file imported twice into one photo', async () => {
    const { photos, failed } = await importPhotos(
      [file('same', 'a.jpg'), file('same', 'b.jpg')],
      store,
      decode,
    )
    expect(failed).toEqual([])
    expect(photos).toHaveLength(1)
    expect(photos[0]).toMatchObject({ width: 800, height: 600, name: 'a.jpg' })
    expect(photos[0]!.id).toMatch(/^[0-9a-f]{64}$/)
    const stored = await store.getPhoto(photos[0]!.id)
    expect(await stored!.original.text()).toBe('same')
  })

  it('reports a file that fails to decode and keeps importing the rest', async () => {
    const { photos, failed } = await importPhotos(
      [file('one', 'a.jpg'), file('two', 'bad.heic'), file('three', 'c.jpg')],
      store,
      decode,
    )
    expect(failed).toEqual(['bad.heic'])
    expect(photos.map((p) => p.name)).toEqual(['a.jpg', 'c.jpg'])
    expect(Object.keys(await store.getPhotosMeta(photos.map((p) => p.id)))).toHaveLength(2)
  })
})
