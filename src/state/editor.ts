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
  flush(): Promise<void>
  bootstrap(): Promise<void>
  openCollection(id: string): Promise<void>
  newCollection(): Promise<void>
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

export interface EditorDeps {
  importPhotos: typeof importPhotos
}

export function createEditorStore(
  store: Store,
  deps: EditorDeps = { importPhotos },
): StoreApi<EditorState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // Saves run strictly one after another, so the newest snapshot is always written last.
  let queue: Promise<void> = Promise.resolve()
  // Counts changes to the collection; queuedRevision is the last one handed to a save.
  let revision = 0
  let queuedRevision = 0
  // Invalidates loads that were started before a newer open, new collection or edit.
  let loadToken = 0
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

    /** Replaces the open collection with a clean one, without counting as an edit. */
    const swap = (c: Collection, photos: Record<string, Photo>, dirty: boolean) => {
      loading = !dirty
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
      if (!dirty) queuedRevision = revision
      loadToken++
    }

    const startFresh = () => {
      const c = emptyCollection()
      swap(c, {}, true)
      void store.setLastCollectionId(c.id).catch((e: unknown) => console.error(e))
    }

    /** Reads first and swaps only if nothing newer (open, new collection, edit) happened meanwhile. */
    const load = async (read: () => Promise<Collection | undefined>) => {
      const token = loadToken
      const rev = revision
      const c = await read()
      if (!c) return
      const photos = c.photoIds.length > 0 ? await store.getPhotosMeta(c.photoIds) : {}
      if (token !== loadToken || rev !== revision) return
      await store.setLastCollectionId(c.id)
      if (token !== loadToken || rev !== revision) return
      swap(c, photos, false)
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
        try {
          const [sizes, lastId] = await Promise.all([
            store.listSizes(),
            store.getLastCollectionId(),
          ])
          set({ savedSizes: sizes })
          const token = loadToken
          if (lastId) await load(() => store.getCollection(lastId))
          // Nothing opened (no last collection, or it is gone): start empty unless something newer took over.
          if (token === loadToken && revision === queuedRevision) startFresh()
        } catch (e) {
          console.error(e)
          startFresh()
        }
      },

      async openCollection(id) {
        if (!(await flushSave())) return
        await load(() => store.getCollection(id))
      },

      async newCollection() {
        // Leaving a collection that could not be saved would lose it.
        if (!(await flushSave())) return
        startFresh()
      },

      flush: async () => {
        await flushSave()
      },

      renameCollection(name) {
        commit({ collection: { ...get().collection, name } })
      },

      async addPhotos(files) {
        const targetId = get().collection.id
        const { photos: imported, failed } = await deps.importPhotos(files, store)
        const addIds = (ids: string[]) => [...new Set([...ids, ...imported.map((p) => p.id)])]
        const { collection, photos } = get()
        if (collection.id === targetId) {
          commit({
            collection: { ...collection, photoIds: addIds(collection.photoIds) },
            photos: { ...photos, ...Object.fromEntries(imported.map((p) => [p.id, p])) },
          })
        } else {
          // The user moved on while importing: the photos belong to the collection they were added to.
          const original = await store.getCollection(targetId)
          if (original) {
            await store.saveCollection({
              ...original,
              photoIds: addIds(original.photoIds),
              updatedAt: Date.now(),
            })
          }
        }
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

  /**
   * Saves the current collection now, after any save already in flight, if it changed
   * since the last save was queued. Resolves true when the current collection is safely
   * stored (a failed save is retried by the next call, since it stays dirty).
   */
  async function flushSave(): Promise<boolean> {
    clearTimeout(timer)
    timer = undefined
    if (revision !== queuedRevision) {
      const r = revision
      queuedRevision = r
      const snapshot: Collection = { ...editor.getState().collection, updatedAt: Date.now() }
      // Stamping updatedAt must not look like a new change.
      loading = true
      editor.setState({ collection: snapshot })
      loading = false
      queue = queue.then(async () => {
        let status: SaveStatus = 'saved'
        try {
          await store.saveCollection(snapshot)
        } catch (e) {
          status = 'full'
          if (!(e instanceof StorageFullError)) console.error(e)
          if (queuedRevision === r) queuedRevision = -1
        }
        // A newer change owns the status (it is still 'saving' and will be saved after this one).
        if (editor.getState().collection.id === snapshot.id && revision === r) {
          editor.setState({ saveStatus: status })
        }
      })
    }
    await queue
    return editor.getState().saveStatus !== 'full'
  }

  editor.subscribe((s, prev) => {
    if (loading || s.collection === prev.collection) return
    revision++
    editor.setState({ saveStatus: 'saving' })
    clearTimeout(timer)
    timer = setTimeout(() => void flushSave(), AUTOSAVE_DELAY_MS)
  })

  return editor
}

/** The app talks to IndexedDB, opened on first use so importing this module has no side effects. */
function lazyIdbStore(): Store {
  let opened: Promise<Store> | undefined
  const open = () => (opened ??= createIdbStore())
  return new Proxy({} as Store, {
    get: (_target, key: string) => {
      // Not a thenable: awaiting the store must not call into IndexedDB.
      if (key === 'then') return undefined
      return (...args: unknown[]) =>
        open().then((s) => (s[key as keyof Store] as (...a: unknown[]) => unknown)(...args))
    },
  })
}

let storage: Store | undefined

/** The app's storage, for reading photo images that the editor state does not hold. */
export function appStorage(): Store {
  return (storage ??= lazyIdbStore())
}

let appStore: StoreApi<EditorState> | undefined

function getAppStore(): StoreApi<EditorState> {
  if (!appStore) {
    const created = createEditorStore(appStorage())
    // iOS can suspend a hidden page before the debounce fires.
    const save = () => void created.getState().flush()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save()
    })
    window.addEventListener('pagehide', save)
    appStore = created
  }
  return appStore
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(getAppStore(), selector)
}
