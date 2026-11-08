import { createStore, useStore, type StoreApi } from 'zustand'
import {
  createFrame,
  duplicateFrame,
  flipOrientation,
  moveLayer,
  placePhoto,
  removeLayer,
  replaceLayerPhoto,
  resizeFrame,
  rotateLayer90,
  updateLayer,
} from '../core/frame'
import { defaultPaper } from '../core/presets'
import type { Collection, Frame, Layer, Paper, Photo, SavedSize, Size } from '../core/types'
import { importPhotos } from '../photos/import'
import { createIdbStore } from '../storage/indexeddb'
import { StorageFullError, type Store } from '../storage/store'
import { t } from '../ui/i18n'

const AUTOSAVE_DELAY_MS = 500

/**
 * - saved:  the latest collection is on disk
 * - saving: a change is waiting for, or going through, a save
 * - full:   the latest save failed, so the work is not safely stored. It is
 *           StorageFullError for a full device; any other save error also lands
 *           here (and is logged), because the banner just says it could not be saved.
 */
export type SaveStatus = 'saved' | 'saving' | 'full'

export interface EditorState {
  collection: Collection
  photos: Record<string, Photo>
  activeFrameId: string | null
  mode: 'browse' | 'edit'
  selectedLayerId: string | null
  replacing: boolean
  saveStatus: SaveStatus
  bootstrap(): Promise<void>
  openCollection(id: string): Promise<void>
  newCollection(): void
  renameCollection(name: string): void
  addPhotos(files: File[]): Promise<{ failed: string[] }>
  tapPhoto(photoId: string): void
  addFrame(size: Size): void
  duplicateActive(): void
  removeActive(): void
  setActive(id: string): void
  setActiveSize(size: Size): void
  flipActive(): void
  enterEdit(layerId?: string): void
  exitEdit(): void
  selectLayer(id: string): void
  startReplace(): void
  transformSelected(patch: Partial<Pick<Layer, 'cx' | 'cy' | 'widthFrac' | 'rotationDeg'>>): void
  rotateSelected(): void
  moveSelected(d: 'forward' | 'back'): void
  removeSelected(): void
  setPaper(p: Partial<Paper>): void
  savedSizes: SavedSize[]
  saveSize(name: string, size: Size): Promise<void>
  deleteSize(id: string): Promise<void>
}

function emptyCollection(): Collection {
  const month = new Date().toLocaleDateString('pt-BR', { month: 'long' })
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: t('collection.defaultName', { month }),
    photoIds: [],
    frames: [],
    paper: defaultPaper(),
    updatedAt: Date.now(),
  }
}

export function createEditorStore(store: Store): StoreApi<EditorState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // Saves run strictly one after another, so the newest snapshot is always written last.
  let queue: Promise<void> = Promise.resolve()
  let saveSeq = 0
  let loading = false

  const editor = createStore<EditorState>()((set, get) => {
    /** Applies a change and keeps active frame, selection and mode consistent. */
    const commit = (patch: Partial<EditorState>) =>
      set((s) => {
        const next = { ...s, ...patch }
        const frames = next.collection.frames
        const activeId =
          frames.find((f) => f.id === next.activeFrameId)?.id ?? frames[0]?.id ?? null
        const frameChanged = activeId !== s.activeFrameId
        const active = frames.find((f) => f.id === activeId)
        const selectionOk =
          !frameChanged &&
          next.selectedLayerId !== null &&
          !!active?.layers.some((l) => l.id === next.selectedLayerId)
        const selectedLayerId = selectionOk ? next.selectedLayerId : null
        const mode = selectedLayerId && next.mode === 'edit' ? 'edit' : 'browse'
        return {
          ...patch,
          activeFrameId: activeId,
          selectedLayerId,
          mode,
          replacing: mode === 'edit' && next.replacing,
        }
      })

    const active = (): Frame | undefined => {
      const { collection, activeFrameId } = get()
      return collection.frames.find((f) => f.id === activeFrameId)
    }

    const updateActive = (fn: (frame: Frame, photos: Record<string, Photo>) => Frame) => {
      const frame = active()
      if (!frame) return
      const { collection, photos } = get()
      const updated = fn(frame, photos)
      commit({
        collection: {
          ...collection,
          frames: collection.frames.map((f) => (f.id === frame.id ? updated : f)),
        },
      })
    }

    const setFrames = (frames: Frame[], activeFrameId: string | null) =>
      commit({ collection: { ...get().collection, frames }, activeFrameId })

    const load = async (c: Collection) => {
      const photos = c.photoIds.length > 0 ? await store.getPhotosMeta(c.photoIds) : {}
      await store.setLastCollectionId(c.id)
      loading = true
      try {
        commit({
          collection: c,
          photos,
          activeFrameId: c.frames[0]?.id ?? null,
          selectedLayerId: null,
          mode: 'browse',
          replacing: false,
          saveStatus: 'saved',
        })
      } finally {
        loading = false
      }
    }

    return {
      collection: emptyCollection(),
      photos: {},
      activeFrameId: null,
      mode: 'browse',
      selectedLayerId: null,
      replacing: false,
      saveStatus: 'saved',
      savedSizes: [],

      async bootstrap() {
        const [sizes, lastId] = await Promise.all([store.listSizes(), store.getLastCollectionId()])
        set({ savedSizes: sizes })
        const last = lastId ? await store.getCollection(lastId) : undefined
        if (last) await load(last)
        else get().newCollection()
      },

      async openCollection(id) {
        await flush()
        const c = await store.getCollection(id)
        if (c) await load(c)
      },

      newCollection() {
        const c = emptyCollection()
        // Anything still pending belongs to the collection being left.
        void flush()
        commit({
          collection: c,
          photos: {},
          activeFrameId: null,
          selectedLayerId: null,
          mode: 'browse',
          replacing: false,
        })
        void store.setLastCollectionId(c.id).catch((e: unknown) => console.error(e))
      },

      renameCollection(name) {
        commit({ collection: { ...get().collection, name } })
      },

      async addPhotos(files) {
        const { photos: imported, failed } = await importPhotos(files, store)
        const { collection, photos } = get()
        const ids = new Set(collection.photoIds)
        imported.forEach((p) => ids.add(p.id))
        commit({
          collection: { ...collection, photoIds: [...ids] },
          photos: { ...photos, ...Object.fromEntries(imported.map((p) => [p.id, p])) },
        })
        return { failed }
      },

      tapPhoto(photoId) {
        const frame = active()
        const photo = get().photos[photoId]
        if (!frame || !photo) return
        const { selectedLayerId, replacing } = get()
        if (replacing && selectedLayerId) {
          updateActive((f) => replaceLayerPhoto(f, selectedLayerId, photo))
          commit({ replacing: false })
          return
        }
        const placed = placePhoto(frame, photo)
        const added = frame.layers.length > 0
        const top = placed.layers[placed.layers.length - 1]
        const { collection } = get()
        commit({
          collection: {
            ...collection,
            frames: collection.frames.map((f) => (f.id === frame.id ? placed : f)),
          },
          ...(added && top ? { mode: 'edit' as const, selectedLayerId: top.id } : {}),
        })
      },

      addFrame(size) {
        const frame = createFrame(size)
        setFrames([...get().collection.frames, frame], frame.id)
      },

      duplicateActive() {
        const frame = active()
        if (!frame) return
        const copy = duplicateFrame(frame)
        const frames = [...get().collection.frames]
        frames.splice(frames.indexOf(frame) + 1, 0, copy)
        setFrames(frames, copy.id)
      },

      removeActive() {
        const frame = active()
        if (!frame) return
        const frames = get().collection.frames
        const i = frames.indexOf(frame)
        const rest = frames.filter((f) => f.id !== frame.id)
        setFrames(rest, (rest[i] ?? rest[i - 1])?.id ?? null)
      },

      setActive(id) {
        commit({ activeFrameId: id })
      },

      setActiveSize(size) {
        updateActive((f, photos) => resizeFrame(f, size, photos))
      },

      flipActive() {
        updateActive((f, photos) => flipOrientation(f, photos))
      },

      enterEdit(layerId) {
        const frame = active()
        const id = layerId ?? frame?.layers[frame.layers.length - 1]?.id
        if (!frame || !id || !frame.layers.some((l) => l.id === id)) return
        commit({ mode: 'edit', selectedLayerId: id, replacing: false })
      },

      exitEdit() {
        commit({ mode: 'browse', selectedLayerId: null, replacing: false })
      },

      selectLayer(id) {
        if (active()?.layers.some((l) => l.id === id)) {
          commit({ mode: 'edit', selectedLayerId: id, replacing: false })
        }
      },

      startReplace() {
        if (get().selectedLayerId) commit({ replacing: true })
      },

      transformSelected(patch) {
        const id = get().selectedLayerId
        if (id) updateActive((f, photos) => updateLayer(f, id, patch, photos))
      },

      rotateSelected() {
        const id = get().selectedLayerId
        if (id) updateActive((f, photos) => rotateLayer90(f, id, photos))
      },

      moveSelected(d) {
        const id = get().selectedLayerId
        if (id) updateActive((f) => moveLayer(f, id, d))
      },

      removeSelected() {
        const id = get().selectedLayerId
        if (id) updateActive((f, photos) => removeLayer(f, id, photos))
      },

      setPaper(p) {
        const { collection } = get()
        commit({ collection: { ...collection, paper: { ...collection.paper, ...p } } })
      },

      async saveSize(name, size) {
        const saved: SavedSize = { id: crypto.randomUUID(), name, ...size }
        await store.saveSize(saved)
        set((s) => ({ savedSizes: [...s.savedSizes, saved] }))
      },

      async deleteSize(id) {
        await store.deleteSize(id)
        set((s) => ({ savedSizes: s.savedSizes.filter((x) => x.id !== id) }))
      },
    }
  })

  /** Writes the current collection now, after any save already in flight. */
  function flush(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    if (editor.getState().saveStatus !== 'saving') return queue
    const snapshot: Collection = { ...editor.getState().collection, updatedAt: Date.now() }
    // Stamping updatedAt must not look like a new change.
    loading = true
    editor.setState({ collection: snapshot })
    loading = false
    const seq = ++saveSeq
    queue = queue.then(async () => {
      let status: SaveStatus = 'saved'
      try {
        await store.saveCollection(snapshot)
      } catch (e) {
        status = 'full'
        if (!(e instanceof StorageFullError)) console.error(e)
      }
      // Only the newest save decides the status; an older one finishing late must not.
      if (seq === saveSeq) editor.setState({ saveStatus: status })
    })
    return queue
  }

  editor.subscribe((s, prev) => {
    if (loading || s.collection === prev.collection) return
    editor.setState({ saveStatus: 'saving' })
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
  })

  return editor
}

/** The app talks to IndexedDB, opened on first use so importing this module has no side effects. */
function lazyIdbStore(): Store {
  let opened: Promise<Store> | undefined
  const open = () => (opened ??= createIdbStore())
  return new Proxy({} as Store, {
    get:
      (_target, key: keyof Store) =>
      (...args: unknown[]) =>
        open().then((s) => (s[key] as (...a: unknown[]) => unknown)(...args)),
  })
}

let appStore: StoreApi<EditorState> | undefined

export function useEditor<T>(selector: (state: EditorState) => T): T {
  appStore ??= createEditorStore(lazyIdbStore())
  return useStore(appStore, selector)
}
