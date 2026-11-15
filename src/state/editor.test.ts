// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdbStore } from '../storage/indexeddb'
import { StorageFullError, type Store } from '../storage/store'
import { defaultPaper } from '../core/presets'
import { uniqueName } from '../core/names'
import type { Collection, Photo } from '../core/types'
import { createEditorStore, ImportNotOpenedError } from './editor'

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

describe('saving around a collection change', () => {
  it('keeps an edit made while the save before switching is being written', async () => {
    const editor = await setup()
    const first = editor.getState().collection.id
    await editor.getState().flush()
    await editor.getState().newCollection()
    const second = editor.getState().collection.id
    await editor.getState().flush()
    editor.getState().renameCollection('before')

    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const save = store.saveCollection.bind(store)
    const spy = vi.spyOn(store, 'saveCollection').mockImplementationOnce(async (c) => {
      await gate
      await save(c)
    })
    const opening = editor.getState().openCollection(first)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    editor.getState().renameCollection('during')
    release()
    await opening

    expect(editor.getState().collection.id).toBe(first)
    expect((await store.getCollection(second))?.name).toBe('during')
  })
})

describe('deleteCollection', () => {
  it('waits for photos being read, and saves them, before deleting another collection', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const editor = createEditorStore(store, {
      importPhotos: async () => {
        await gate
        return { photos: [photo('late')], failed: [] }
      },
    })
    await editor.getState().bootstrap()
    editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
    const other = editor.getState().collection.id
    await editor.getState().flush()
    await editor.getState().newCollection()
    const open = editor.getState().collection.id
    await editor.getState().flush()

    const adding = editor.getState().addPhotos([])
    const deleting = editor.getState().deleteCollection(other)
    await advance(0)
    expect(await store.getCollection(other)).toBeDefined()

    release()
    await Promise.all([adding, deleting])
    expect(await store.getCollection(other)).toBeUndefined()
    expect((await store.getCollection(open))?.photoIds).toEqual(['late'])
  })

  async function twoCollections() {
    const editor = await setup()
    const first = editor.getState().collection.id
    await editor.getState().flush()
    await editor.getState().newCollection()
    const second = editor.getState().collection.id
    await editor.getState().flush()
    return { editor, first, second }
  }

  it('removes another collection and leaves the open one alone', async () => {
    const { editor, first, second } = await twoCollections()
    await editor.getState().deleteCollection(first)
    expect(editor.getState().collection.id).toBe(second)
    expect((await store.listCollections()).map((c) => c.id)).toEqual([second])
  })

  it('deleting the open collection leaves an unsaved draft', async () => {
    const { editor, first, second } = await twoCollections()
    await editor.getState().deleteCollection(second)
    expect(editor.getState().collection.id).not.toBe(second)
    expect(editor.getState().collection.id).not.toBe(first)
    expect(editor.getState().collection.frames).toHaveLength(0)
    await advance(1000)
    await editor.getState().listCollections()
    expect((await store.listCollections()).map((c) => c.id)).toEqual([first])
  })

  it('leaves a draft when the only collection is deleted', async () => {
    const editor = await setup()
    const only = editor.getState().collection.id
    await editor.getState().flush()
    await editor.getState().deleteCollection(only)
    expect(editor.getState().collection.id).not.toBe(only)
    expect(editor.getState().collection.frames).toHaveLength(0)
    expect(await store.getCollection(only)).toBeUndefined()
    expect(await store.listCollections()).toEqual([])
  })

  it('does not delete the open collection when it is opened again while the draft starts', async () => {
    const { editor, second } = await twoCollections()
    const list = store.listCollections.bind(store)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const spy = vi.spyOn(store, 'listCollections').mockImplementationOnce(async () => {
      await gate
      return list()
    })
    const deleting = editor.getState().deleteCollection(second)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await editor.getState().openCollection(second)
    release()
    await expect(deleting).rejects.toThrow()
    expect(editor.getState().collection.id).toBe(second)
    expect(await store.getCollection(second)).toBeDefined()
  })

  it('is not undone by a save that was still waiting', async () => {
    const { editor, second } = await twoCollections()
    editor.getState().renameCollection('edited')
    await editor.getState().deleteCollection(second)
    await advance(1000)
    expect(await store.getCollection(second)).toBeUndefined()
  })
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

  it('places the photo when it is meant for the frame still active', async () => {
    const editor = await setup()
    const target = editor.getState().activeFrameId!
    editor.getState().tapPhoto('a', target)
    expect(editor.getState().collection.frames[0]!.layers).toHaveLength(1)
  })

  it('adds nothing when the photo was meant for a frame no longer active', async () => {
    const editor = await setup()
    const target = editor.getState().activeFrameId!
    editor.getState().addFrame({ widthMm: 50, heightMm: 70 })
    editor.getState().tapPhoto('a', target)
    const s = editor.getState()
    expect(s.collection.frames.flatMap((f) => f.layers)).toHaveLength(0)
    expect(s.mode).toBe('browse')
  })

  it('selects a late photo while the frame is still being edited', async () => {
    const editor = await setup()
    const target = editor.getState().activeFrameId!
    editor.getState().tapPhoto('a')
    editor.getState().enterEdit()
    editor.getState().tapPhoto('b', target)
    const s = editor.getState()
    expect(s.mode).toBe('edit')
    expect(s.selectedLayerId).toBe(s.collection.frames[0]!.layers[1]!.id)
  })

  it('places a late photo without reopening an edit that was closed meanwhile', async () => {
    const editor = await setup()
    const target = editor.getState().activeFrameId!
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b', target)
    const s = editor.getState()
    expect(s.collection.frames[0]!.layers).toHaveLength(2)
    expect(s.mode).toBe('browse')
    expect(s.selectedLayerId).toBeNull()
  })

  it('zooms the selected layer from its latest width, so quick ticks add up', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    editor.getState().zoomSelected(2)
    editor.getState().zoomSelected(2)
    expect(editor.getState().collection.frames[0]!.layers[1]!.widthFrac).toBeCloseTo(2)
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

  it('keeps editing, with the new top layer selected, when others remain', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    editor.getState().tapPhoto('a')
    const [, middle] = editor.getState().collection.frames[0]!.layers
    editor.getState().selectLayer(middle!.id)
    editor.getState().removeSelected()
    const s = editor.getState()
    const layers = s.collection.frames[0]!.layers
    expect(layers).toHaveLength(2)
    expect(s.mode).toBe('edit')
    expect(s.selectedLayerId).toBe(layers[1]!.id)
  })

  it('returns to browse when the last layer is removed', async () => {
    const editor = await setup()
    editor.getState().tapPhoto('a')
    editor.getState().enterEdit()
    editor.getState().removeSelected()
    const s = editor.getState()
    expect(s.collection.frames[0]!.layers).toHaveLength(0)
    expect(s.mode).toBe('browse')
    expect(s.selectedLayerId).toBeNull()
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
    expect(s.collection.name).toMatch(/^Fotos de \d+ de [a-zç]+$/)
  })

  it('numbers a new collection when another started the same day', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    const first = editor.getState().collection.name
    editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
    await editor.getState().flush()
    await editor.getState().newCollection()
    expect(editor.getState().collection.name).toBe(`${first} (2)`)
  })

  it('opens nothing and saves nothing, but loads sizes and folders', async () => {
    await store.saveCollection({ ...stored('a'), updatedAt: 1 })
    await store.saveCollection({ ...stored('b'), updatedAt: 2 })
    await store.setLastCollectionId('a')
    await store.saveSize({ id: 's1', name: 'Mini', widthMm: 50, heightMm: 50 })
    await store.saveFolder({ id: 'f1', name: 'Pasta', createdAt: 1 })
    const save = vi.spyOn(store, 'saveCollection')
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    await advance(1000)
    expect(editor.getState().collection.id).not.toBe('a')
    expect(editor.getState().collection.id).not.toBe('b')
    expect(editor.getState().collection.frames).toEqual([])
    expect(editor.getState().savedSizes).toHaveLength(1)
    expect(editor.getState().folders.map((f) => f.id)).toEqual(['f1'])
    expect(await store.listCollections()).toHaveLength(2)
    expect(save).not.toHaveBeenCalled()
  })
})

const stored = (id: string, photoIds: string[] = []): Collection => ({
  schemaVersion: 1,
  id,
  name: id,
  photoIds,
  frames: [],
  paper: defaultPaper(),
  updatedAt: 1,
})

describe('never losing the latest edit', () => {
  it('saves an edit made during an in-flight save even if that save ends before the debounce', async () => {
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
    await advance(100)
    release()
    await advance(0)
    expect(editor.getState().saveStatus).toBe('saving')
    await advance(400)
    expect(names).toEqual(['primeira', 'segunda'])
    expect((await store.getCollection(editor.getState().collection.id))?.name).toBe('segunda')
    expect(editor.getState().saveStatus).toBe('saved')
  })

  it('flush writes before the debounce', async () => {
    const editor = await setup()
    await advance(600)
    editor.getState().renameCollection('agora')
    await editor.getState().flush()
    expect((await store.getCollection(editor.getState().collection.id))?.name).toBe('agora')
    expect(editor.getState().saveStatus).toBe('saved')
  })

  it('does not switch collections when the current one cannot be saved', async () => {
    const editor = await setup()
    await advance(600)
    await store.saveCollection(stored('outra'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spy = vi.spyOn(store, 'saveCollection').mockRejectedValue(new Error('boom'))
    const id = editor.getState().collection.id
    editor.getState().renameCollection('pendente')

    await editor.getState().openCollection('outra')
    expect(editor.getState().collection.id).toBe(id)
    expect(editor.getState().saveStatus).toBe('full')

    await expect(editor.getState().newCollection()).rejects.toThrow()
    expect(editor.getState().collection.id).toBe(id)
    expect(editor.getState().collection.name).toBe('pendente')
    expect(log).toHaveBeenCalled()

    spy.mockRestore()
    await editor.getState().openCollection('outra')
    expect(editor.getState().collection.id).toBe('outra')
    expect((await store.getCollection(id))?.name).toBe('pendente')
  })

  it('puts photos imported into a collection that is no longer open on the original one', async () => {
    let finish!: () => void
    const gate = new Promise<void>((r) => (finish = r))
    const editor = createEditorStore(store, {
      importPhotos: async () => {
        await gate
        return { photos: [photo('novo')], failed: ['ruim.jpg'] }
      },
    })
    await editor.getState().bootstrap()
    editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
    await advance(600)
    const originalId = editor.getState().collection.id
    await store.saveCollection(stored('outra'))

    const pending = editor.getState().addPhotos([])
    const opening = editor.getState().openCollection('outra')
    finish()
    await opening
    expect(await pending).toEqual({ failed: ['ruim.jpg'], photoIds: ['novo'] })

    expect(editor.getState().collection.id).toBe('outra')
    expect(editor.getState().collection.photoIds).toEqual([])
    expect(editor.getState().photos['novo']).toBeUndefined()
    expect((await store.getCollection(originalId))?.photoIds).toEqual(['novo'])
  })

  it('adds imported photos to the open collection', async () => {
    const editor = createEditorStore(store, {
      importPhotos: async () => ({ photos: [photo('novo')], failed: [] }),
    })
    await editor.getState().bootstrap()
    await editor.getState().addPhotos([])
    expect(editor.getState().collection.photoIds).toEqual(['novo'])
    expect(editor.getState().photos['novo']).toBeDefined()
  })

  it('drops a stale open when an edit happens while it loads', async () => {
    const editor = await setup()
    await advance(600)
    await store.saveCollection(stored('outra', ['p']))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const real = store.getPhotosMeta.bind(store)
    vi.spyOn(store, 'getPhotosMeta').mockImplementation(async (ids) => {
      await gate
      return real(ids)
    })
    const opening = editor.getState().openCollection('outra')
    await advance(0)
    editor.getState().renameCollection('minha edicao')
    release()
    await opening
    expect(editor.getState().collection.name).toBe('minha edicao')
    await advance(500)
    expect((await store.getCollection(editor.getState().collection.id))?.name).toBe('minha edicao')
  })

  describe('when the saved work cannot be read at first', () => {
    it('writes nothing and reports the failure', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      await store.saveCollection(stored('a'))
      vi.spyOn(store, 'listSizes').mockRejectedValueOnce(new Error('read'))
      const setLast = vi.spyOn(store, 'setLastCollectionId')
      const save = vi.spyOn(store, 'saveCollection')
      const editor = createEditorStore(store)
      await editor.getState().bootstrap()
      await advance(1000)
      expect(log).toHaveBeenCalled()
      expect(editor.getState().loadFailed).toBe(true)
      expect(setLast).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
    })

    it('leaves the failure behind when another work is opened', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await store.saveCollection(stored('b'))
      vi.spyOn(store, 'listSizes').mockRejectedValueOnce(new Error('read'))
      const editor = createEditorStore(store)
      await editor.getState().bootstrap()
      expect(editor.getState().loadFailed).toBe(true)
      expect(await editor.getState().openCollection('b')).toBe(true)
      expect(editor.getState().loadFailed).toBe(false)
      expect(editor.getState().collection.id).toBe('b')
    })

    it('recovers on a retry', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(store, 'listSizes').mockRejectedValueOnce(new Error('read'))
      const editor = createEditorStore(store)
      await editor.getState().bootstrap()
      await editor.getState().bootstrap()
      expect(editor.getState().loadFailed).toBe(false)
    })
  })

  it('still opens a collection when remembering it cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await store.saveCollection(stored('a'))
    vi.spyOn(store, 'setLastCollectionId').mockRejectedValue(new StorageFullError())
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    expect(await editor.getState().openCollection('a')).toBe(true)
    expect(editor.getState().collection.id).toBe('a')
  })
})

describe('collections list actions', () => {
  it('openCollection returns false for a missing id', async () => {
    const editor = await setup()
    const id = editor.getState().collection.id
    expect(await editor.getState().openCollection('nope')).toBe(false)
    expect(editor.getState().collection.id).toBe(id)
  })

  it('openCollection returns true and opens an existing one', async () => {
    await store.saveCollection(stored('x'))
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    expect(await editor.getState().openCollection('x')).toBe(true)
    expect(editor.getState().collection.id).toBe('x')
  })

  it('newCollection saves at once and returns its id', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    const id = await editor.getState().newCollection()
    expect(editor.getState().collection.id).toBe(id)
    expect(await store.getCollection(id)).toBeDefined()
    expect((await store.listCollections()).map((c) => c.id)).toEqual([id])
  })

  it('closeCollection saves the open one and leaves an unsaved draft', async () => {
    const editor = await setup()
    const id = editor.getState().collection.id
    await editor.getState().closeCollection()
    expect((await store.getCollection(id))?.frames).toHaveLength(1)
    expect(editor.getState().collection.id).not.toBe(id)
    expect(editor.getState().collection.frames).toEqual([])
    await advance(1000)
    expect(await store.listCollections()).toHaveLength(1)
  })

  it('bootstrap does not replace a collection opened while it reads', async () => {
    await store.saveCollection(stored('x'))
    const list = store.listCollections.bind(store)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const spy = vi.spyOn(store, 'listCollections').mockImplementationOnce(async () => {
      await gate
      return list()
    })
    const editor = createEditorStore(store)
    const booting = editor.getState().bootstrap()
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await editor.getState().openCollection('x')
    editor.getState().renameCollection('editada')
    release()
    await booting
    expect(editor.getState().collection.id).toBe('x')
    expect(editor.getState().collection.name).toBe('editada')
    await advance(1000)
    expect((await store.getCollection('x'))?.name).toBe('editada')
  })

  it('closeCollection keeps an edit made while it reads the names', async () => {
    const editor = await setup()
    const id = editor.getState().collection.id
    await editor.getState().flush()
    const list = store.listCollections.bind(store)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const spy = vi.spyOn(store, 'listCollections').mockImplementationOnce(async () => {
      await gate
      return list()
    })
    const closing = editor.getState().closeCollection()
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    editor.getState().renameCollection('durante')
    release()
    await closing
    expect((await store.getCollection(id))?.name).toBe('durante')
    expect(editor.getState().collection.id).not.toBe(id)
    expect(editor.getState().collection.frames).toEqual([])
  })

  it('closeCollection does not replace a collection opened while it closes', async () => {
    await store.saveCollection(stored('x'))
    const editor = await setup()
    await editor.getState().flush()
    const list = store.listCollections.bind(store)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const spy = vi.spyOn(store, 'listCollections').mockImplementationOnce(async () => {
      await gate
      return list()
    })
    const closing = editor.getState().closeCollection()
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    await editor.getState().openCollection('x')
    release()
    await closing
    expect(editor.getState().collection.id).toBe('x')
  })

  it('leaving a draft while photos import keeps them in that collection', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const editor = createEditorStore(store, {
      importPhotos: async () => {
        await gate
        return { photos: [photo('late')], failed: [] }
      },
    })
    await editor.getState().bootstrap()
    const draftId = editor.getState().collection.id
    const adding = editor.getState().addPhotos([])
    const closing = editor.getState().closeCollection()
    await advance(0)
    release()
    await Promise.all([adding, closing])
    expect((await store.getCollection(draftId))?.photoIds).toEqual(['late'])
    expect(editor.getState().collection.id).not.toBe(draftId)
  })

  it('listCollections includes an edit made just before going back', async () => {
    const editor = await setup()
    await editor.getState().flush()
    editor.getState().renameCollection('Recem editada')
    expect((await editor.getState().listCollections())[0]?.name).toBe('Recem editada')
  })

  it('renameCollectionById renames a collection that is not open', async () => {
    await store.saveCollection(stored('x'))
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    await editor.getState().renameCollectionById('x', 'Novo nome')
    expect((await store.getCollection('x'))?.name).toBe('Novo nome')
  })

  it('renameCollectionById renames the open collection through the editor', async () => {
    const editor = await setup()
    const id = editor.getState().collection.id
    await editor.getState().renameCollectionById(id, 'Aberta')
    expect(editor.getState().collection.name).toBe('Aberta')
    await editor.getState().flush()
    expect((await store.getCollection(id))?.name).toBe('Aberta')
  })

  it('duplicateCollection copies frames with new ids and a unique name', async () => {
    const editor = await setup()
    editor.getState().renameCollection('Praia')
    editor.getState().tapPhoto('a')
    const original = editor.getState().collection
    await store.saveCollection({ ...stored('other'), name: 'Praia (cópia)' })

    const id = await editor.getState().duplicateCollection(original.id)
    const copy = await store.getCollection(id)
    expect(id).not.toBe(original.id)
    expect(copy?.name).toBe(uniqueName('Praia (cópia)', ['Praia', 'Praia (cópia)']))
    expect(copy?.name).not.toBe('Praia (cópia)')
    expect(copy?.frames).toHaveLength(1)
    expect(copy?.frames[0]?.id).not.toBe(original.frames[0]?.id)
    expect(copy?.frames[0]?.layers[0]?.id).not.toBe(original.frames[0]?.layers[0]?.id)
    expect(copy?.frames[0]?.layers[0]?.photoId).toBe('a')
    expect((await store.getCollection(original.id))?.name).toBe('Praia')
    expect(editor.getState().collection.id).toBe(original.id)
  })

  it('importCollection rejects when the imported collection could not be opened', async () => {
    const editor = await setup()
    const id = editor.getState().collection.id
    await editor.getState().flush()
    const bundle = await editor.getState().exportActive()
    await editor.getState().deleteCollection(id)
    editor.setState({ openCollection: async () => false })
    await expect(editor.getState().importCollection(bundle)).rejects.toBeInstanceOf(
      ImportNotOpenedError,
    )
  })

  it('duplicateCollection rejects for a missing id', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    await expect(editor.getState().duplicateCollection('nope')).rejects.toThrow()
  })
})

describe('folders and sizes', () => {
  it('saves, renames and lists folders', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    const f = await editor.getState().saveFolder('Casamento')
    expect(editor.getState().folders.map((x) => x.name)).toEqual(['Casamento'])
    await editor.getState().renameFolder(f.id, 'Festa')
    expect(editor.getState().folders[0]?.name).toBe('Festa')
    expect((await store.listFolders())[0]?.name).toBe('Festa')
  })

  it('deleteFolder moves its sizes to Meus tamanhos', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    const f = await editor.getState().saveFolder('Pasta')
    await editor.getState().saveSize('Mini', { widthMm: 50, heightMm: 50 }, f.id)
    expect(editor.getState().savedSizes[0]?.folderId).toBe(f.id)
    await editor.getState().deleteFolder(f.id)
    expect(editor.getState().folders).toEqual([])
    expect(editor.getState().savedSizes).toHaveLength(1)
    expect(editor.getState().savedSizes[0]?.folderId).toBeUndefined()
    expect((await store.listSizes())[0]?.folderId).toBeUndefined()
  })

  it('updateSize changes name and folder, and can clear the folder', async () => {
    const editor = createEditorStore(store)
    await editor.getState().bootstrap()
    const f = await editor.getState().saveFolder('Pasta')
    await editor.getState().saveSize('Mini', { widthMm: 50, heightMm: 50 })
    const id = editor.getState().savedSizes[0]!.id
    await editor.getState().updateSize(id, { name: 'Maxi', folderId: f.id })
    expect(editor.getState().savedSizes[0]).toMatchObject({ name: 'Maxi', folderId: f.id })
    expect((await store.listSizes())[0]).toMatchObject({ name: 'Maxi', folderId: f.id })
    await editor.getState().updateSize(id, { folderId: undefined })
    expect(editor.getState().savedSizes[0]?.folderId).toBeUndefined()
    expect(editor.getState().savedSizes[0]?.name).toBe('Maxi')
    expect((await store.listSizes())[0]?.folderId).toBeUndefined()
  })
})

describe('deletePhoto', () => {
  const blobs = { original: new Blob(['o']), preview: new Blob(['p']), thumb: new Blob(['t']) }

  /** Two frames using photo a, one of them also using b, all saved. */
  async function withPhotoInTwoFrames() {
    const editor = await setup()
    await store.putPhoto({ ...photo('a'), ...blobs })
    await store.putPhoto({ ...photo('b'), ...blobs })
    const { collection } = editor.getState()
    editor.setState({ collection: { ...collection, photoIds: ['a', 'b'] } })
    editor.getState().tapPhoto('a')
    editor.getState().addFrame({ widthMm: 100, heightMm: 150 })
    editor.getState().tapPhoto('a')
    editor.getState().tapPhoto('b')
    editor.getState().exitEdit()
    await editor.getState().flush()
    return editor
  }

  const shownPerFrame = (frames: { layers: { photoId: string }[] }[]) =>
    frames.map((f) => f.layers.map((l) => l.photoId))

  it('takes the photo out of the tray and of every frame, on screen and on disk', async () => {
    const editor = await withPhotoInTwoFrames()
    await editor.getState().deletePhoto('a')

    const { collection, photos } = editor.getState()
    expect(collection.photoIds).toEqual(['b'])
    expect(photos.a).toBeUndefined()
    expect(shownPerFrame(collection.frames)).toEqual([[], ['b']])
    const saved = await store.getCollection(collection.id)
    expect(saved?.photoIds).toEqual(['b'])
    expect(shownPerFrame(saved?.frames ?? [])).toEqual([[], ['b']])
    expect(await store.getPhoto('a')).toBeUndefined()
  })

  it('keeps the file for another collection that uses the same photo', async () => {
    const editor = await withPhotoInTwoFrames()
    const { collection } = editor.getState()
    await store.saveCollection({ ...collection, id: 'other', photoIds: ['a'] })
    await editor.getState().deletePhoto('a')
    expect(await store.getPhoto('a')).toBeDefined()
    expect((await store.getCollection('other'))?.photoIds).toEqual(['a'])
  })

  it('keeps the file while the saved collection still lists the photo', async () => {
    const editor = await withPhotoInTwoFrames()
    vi.spyOn(store, 'saveCollection').mockRejectedValueOnce(new StorageFullError())
    await editor.getState().deletePhoto('a')
    expect(editor.getState().saveStatus).toBe('full')
    expect(await store.getPhoto('a')).toBeDefined()
  })

  it('leaves editing when the selected photo is the one deleted', async () => {
    const editor = await withPhotoInTwoFrames()
    editor.getState().enterEdit()
    expect(editor.getState().mode).toBe('edit')
    await editor.getState().deletePhoto('b')
    expect(editor.getState().mode).toBe('browse')
    expect(editor.getState().selectedLayerId).toBeNull()
  })
})
