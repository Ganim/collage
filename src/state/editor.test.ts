// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdbStore } from '../storage/indexeddb'
import { StorageFullError, type Store } from '../storage/store'
import type { Photo } from '../core/types'
import { createEditorStore } from './editor'

let n = 0

/** Only setTimeout and Date are faked so IndexedDB keeps working; then let its work finish. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}
let store: Store

const photo = (id: string, width = 800, height = 600): Photo => ({ id, width, height, name: id })

async function setup() {
  const editor = createEditorStore(store)
  await editor.getState().bootstrap()
  editor.setState({ photos: { a: photo('a'), b: photo('b') } })
  editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
  return editor
}

beforeEach(async () => {
  store = await createIdbStore(`editor-${n++}`)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('tapPhoto', () => {
  it('makes the photo the background of an empty frame and stays in browse', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    const s = editor.getState()
    expect(s.collection.frames[0]!.layers).toHaveLength(1)
    expect(s.mode).toBe('browse')
  })

  it('adds a layer to a frame with photos, enters edit and selects it', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    const s = editor.getState()
    const layers = s.collection.frames[0]!.layers
    expect(layers).toHaveLength(2)
    expect(s.mode).toBe('edit')
    expect(s.selectedLayerId).toBe(layers[1]!.id)
  })

  it('replaces the selected photo after startReplace and turns replacing off', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('a')
    editor.getState().startReplace()
    expect(editor.getState().replacing).toBe(true)
    editor.getState().tapPhoto('b')
    const s = editor.getState()
    const layers = s.collection.frames[0]!.layers
    expect(layers).toHaveLength(2)
    expect(layers[1]!.photoId).toBe('b')
    expect(s.replacing).toBe(false)
  })

  it('does nothing without an active frame', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    editor.setState({ photos: { a: photo('a') } })
    editor.getState().tapPhoto('a')
    expect(editor.getState().collection.frames).toHaveLength(0)
  })
})

describe('selection', () => {
  it('enterEdit without id selects the top layer', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    editor.getState().exitEdit()
    editor.getState().enterEdit()
    const layers = editor.getState().collection.frames[0]!.layers
    expect(editor.getState().selectedLayerId).toBe(layers[1]!.id)
    expect(editor.getState().mode).toBe('edit')
  })

  it('returns to browse when the selected layer is removed', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    editor.getState().removeSelected()
    expect(editor.getState().mode).toBe('browse')
    expect(editor.getState().selectedLayerId).toBeNull()
  })

  it('leaves edit when the active frame changes or is removed', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    editor.getState().addFrame({ widthMm: 50, heightMm: 70 })
    expect(editor.getState().mode).toBe('browse')
    editor.getState().removeActive()
    expect(editor.getState().collection.frames).toHaveLength(1)
    expect(editor.getState().activeFrameId).toBe(editor.getState().collection.frames[0]!.id)
    expect(editor.getState().selectedLayerId).toBeNull()
  })
})

describe('autosave', () => {
  it('saves once, 500 ms after a burst of changes', async () => {
    const editor = await setup()
    await advance(600)
    const spy = vi.spyOn(store, 'saveCollection')
    editor.getState().renameCollection('um')
    editor.getState().renameCollection('dois')
    expect(editor.getState().saveStatus).toBe('saving')
    await advance(499)
    expect(spy).not.toHaveBeenCalled()
    await advance(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(editor.getState().saveStatus).toBe('saved')
    const saved = await store.getCollection(editor.getState().collection.id)
    expect(saved?.name).toBe('dois')
    expect(editor.getState().collection.updatedAt).toBeGreaterThan(0)
  })

  it('goes to full on StorageFullError and keeps the collection in memory', async () => {
    const editor = await setup()
    await advance(600)
    vi.spyOn(store, 'saveCollection').mockRejectedValue(new StorageFullError())
    editor.getState().renameCollection('guardada')
    await advance(500)
    expect(editor.getState().saveStatus).toBe('full')
    expect(editor.getState().collection.name).toBe('guardada')
  })

  it('reports other save errors as a failed save and logs them', async () => {
    const editor = await setup()
    await advance(600)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(store, 'saveCollection').mockRejectedValue(new Error('boom'))
    editor.getState().renameCollection('x')
    await advance(500)
    expect(editor.getState().saveStatus).toBe('full')
    expect(log).toHaveBeenCalled()
  })

  it('saves the newest collection last when a change arrives during a save', async () => {
    const editor = await setup()
    await advance(600)
    const names: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const real = store.saveCollection.bind(store)
    vi.spyOn(store, 'saveCollection').mockImplementation(async (c) => {
      if (names.length === 0) await gate
      names.push(c.name)
      await real(c)
    })
    editor.getState().renameCollection('primeira')
    await advance(500)
    editor.getState().renameCollection('segunda')
    await advance(500)
    release()
    await advance(0)
    expect(names).toEqual(['primeira', 'segunda'])
    expect((await store.getCollection(editor.getState().collection.id))?.name).toBe('segunda')
    expect(editor.getState().saveStatus).toBe('saved')
  })
})

describe('bootstrap', () => {
  it('creates an empty collection named after the month when none exists', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    const s = editor.getState()
    expect(s.collection.frames).toEqual([])
    expect(s.collection.name).toMatch(/^Fotos de [a-zç]+$/)
  })

  it('reopens the last collection with its photos and saved sizes', async () => {
    await store.saveSize({ id: 's1', name: 'Mini', widthMm: 50, heightMm: 50 })
    const first = createEditorStore(store)
    await first.getState().bootstrap()
    await store.putPhoto({
      ...photo('p1'),
      original: new Blob(['o']),
      preview: new Blob(['p']),
      thumb: new Blob(['t']),
    })
    first.getState().renameCollection('Minha')
    first.setState((s) => ({ collection: { ...s.collection, photoIds: ['p1'] } }))
    await advance(500)
    const id = first.getState().collection.id

    const second = createEditorStore(store)
    await second.getState().bootstrap()
    expect(second.getState().collection.id).toBe(id)
    expect(second.getState().collection.name).toBe('Minha')
    expect(second.getState().photos['p1']?.width).toBe(800)
    expect(second.getState().savedSizes).toHaveLength(1)
  })
})
