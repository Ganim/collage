import { createStore, useStore, type StoreApi } from 'zustand'
import {
  copyCollection,
  createFrame,
  duplicateFrame,
  flipOrientation,
  moveLayer,
  placePhoto,
  removeLayer,
  removePhotoLayers,
  replaceLayerPhoto,
  resizeFrame,
  rotateLayer90,
  updateLayer,
  zoomLayer,
} from '../core/frame'
import { uniqueName } from '../core/names'
import { defaultPaper } from '../core/presets'
import type {
  Collection,
  Frame,
  Layer,
  Paper,
  Photo,
  SavedSize,
  Size,
  SizeFolder,
} from '../core/types'
import { importPhotos } from '../photos/import'
import { exportBundle, importBundle } from '../storage/bundle'
import { createIdbStore } from '../storage/indexeddb'
import { reopeningStore } from '../storage/reopening'
import { StorageFullError, type CollectionSummary, type Store } from '../storage/store'
import { useSyncStatus } from '../sync/status'
import { t } from '../ui/i18n'

const AUTOSAVE_DELAY_MS = 500

/**
 * - saved:  the latest collection is on disk
 * - saving: a change is waiting for, or going through, a save
 * - full:   the latest save failed, so the work is not safely stored. It is
 *           StorageFullError for a full device; any other save error also lands
 *           here (and is logged), because the banner just says it could not be saved.
 */
/** A .collage file was stored as a collection, but the open work could not be left to show it. */
export class ImportNotOpenedError extends Error {
  constructor() {
    super('The imported collection could not be opened')
    this.name = 'ImportNotOpenedError'
  }
}

export type SaveStatus = 'saved' | 'saving' | 'full'

export interface EditorState {
  collection: Collection
  photos: Record<string, Photo>
  activeFrameId: string | null
  mode: 'browse' | 'edit'
  selectedLayerId: string | null
  replacing: boolean
  saveStatus: SaveStatus
  /** The saved work could not be read. Calling bootstrap again tries once more. */
  loadFailed: boolean
  /** Opening the saved work waits for another tab of the app to close (it holds an older version). */
  storageBlocked: boolean
  flush(): Promise<void>
  bootstrap(): Promise<void>
  /** False, changing nothing, if there is no such collection or the open one could not be saved. */
  openCollection(id: string): Promise<boolean>
  /** Creates and saves an empty collection, opens it and returns its id. */
  newCollection(): Promise<string>
  /** Saves the open collection and leaves an empty draft that is not saved. */
  closeCollection(): Promise<void>
  renameCollection(name: string): void
  renameCollectionById(id: string, name: string): Promise<void>
  /** Saves a copy under a free name and returns its id. The open collection stays open. */
  duplicateCollection(id: string): Promise<string>
  /** Newest first, with the latest edits of the open collection already saved. */
  listCollections(): Promise<CollectionSummary[]>
  deleteCollection(id: string): Promise<void>
  /** The open collection as a .collage file. Rejects if its latest edits could not be saved. */
  exportActive(): Promise<Blob>
  /**
   * Opens a .collage file as a new collection. Rejects, changing nothing, if it is invalid; also
   * rejects when it was stored but could not be opened (the open work could not be saved).
   */
  importCollection(file: Blob): Promise<void>
  /** photoIds lists every readable file, including one the collection already had. */
  addPhotos(files: File[]): Promise<{ failed: string[]; photoIds: string[] }>
  /** Removes the photo from the open collection: its tray entry and every frame showing it. */
  deletePhoto(photoId: string): Promise<void>
  /** Deletes several photos, one after another. */
  deletePhotos(photoIds: string[]): Promise<void>
  /**
   * With onlyOnFrameId, for a photo that took a while to read: does nothing unless that frame
   * is still the active one, and does not reopen an edit that was closed in the meantime.
   */
  tapPhoto(photoId: string, onlyOnFrameId?: string): void
  addFrame(size: Size): void
  /** One new frame of this size per photo, at the end; the first new one becomes active. */
  framesForPhotos(size: Size, photoIds: string[]): void
  /** Several empty frames of one size at the end; the first new one becomes active. */
  addFrames(size: Size, count: number): void
  /** Each frame given gets a copy right after it; the first copy becomes active. */
  duplicateFrames(ids: string[]): void
  /** Removes the frames given; the nearest remaining one stays active. */
  removeFrames(ids: string[]): void
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
  zoomSelected(factor: number): void
  rotateSelected(): void
  moveSelected(d: 'forward' | 'back'): void
  removeSelected(): void
  setPaper(p: Partial<Paper>): void
  savedSizes: SavedSize[]
  folders: SizeFolder[]
  saveSize(name: string, size: Size, folderId?: string): Promise<void>
  updateSize(id: string, patch: { name?: string; folderId?: string | undefined }): Promise<void>
  deleteSize(id: string): Promise<void>
  saveFolder(name: string): Promise<SizeFolder>
  renameFolder(id: string, name: string): Promise<void>
  /** Its sizes go back to "Meus tamanhos". */
  deleteFolder(id: string): Promise<void>
  /**
   * After the sync changed the store: reads sizes and folders again and, when the open collection
   * is among `changedIds` and has no unsaved edit, reads it again keeping the active frame if it
   * still exists. A deleted one is closed (the app then shows the list with its notice).
   */
  reloadFromStore(changedIds: string[]): Promise<void>
}

function emptyCollection(takenNames: string[]): Collection {
  const today = new Date()
  const month = today.toLocaleDateString('pt-BR', { month: 'long' })
  const name = t('collection.defaultName', { day: today.getDate(), month })
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: uniqueName(name, takenNames),
    photoIds: [],
    frames: [],
    paper: defaultPaper(),
    updatedAt: Date.now(),
  }
}

const newestFirst = (list: CollectionSummary[]) =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt)

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
  // Settles when every photo import started so far has finished.
  let imports: Promise<unknown> = Promise.resolve()
  // Counts changes to the collection; queuedRevision is the last one handed to a save.
  let revision = 0
  let queuedRevision = 0
  // Invalidates loads that were started before a newer open, new collection or edit.
  let loadToken = 0
  let loading = false
  // The stored version the open collection's edits start from, so a save never overwrites a
  // version the sync pulled in the meantime.
  let base: { id: string; updatedAt: number } | null = null

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
      base = { id: c.id, updatedAt: c.updatedAt }
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
          loadFailed: false,
        })
      } finally {
        loading = false
      }
      if (!dirty) queuedRevision = revision
      loadToken++
    }

    /**
     * Swaps in an empty collection that is not saved until the first edit. Does nothing, and
     * says why: 'moved' if something else opened a collection while the names were read,
     * 'edited' if (with strict) the open one was edited meanwhile.
     */
    const startDraft = async (
      excludeId?: string,
      strict = true,
    ): Promise<'swapped' | 'moved' | 'edited'> => {
      const token = loadToken
      const rev = revision
      const names = (await store.listCollections())
        .filter((c) => c.id !== excludeId)
        .map((c) => c.name)
      if (token !== loadToken) return 'moved'
      if (strict && rev !== revision) return 'edited'
      swap(emptyCollection(names), {}, false)
      return 'swapped'
    }

    /** Reads first and swaps only if nothing newer (open, new collection, edit) happened meanwhile. */
    const load = async (read: () => Promise<Collection | undefined>): Promise<boolean> => {
      const token = loadToken
      const rev = revision
      const c = await read()
      if (!c) return false
      const photos = c.photoIds.length > 0 ? await store.getPhotosMeta(c.photoIds) : {}
      if (token !== loadToken || rev !== revision) return true
      // Only a convenience (the e2e helpers read it): on a full device it must not stop the work from opening.
      await store.setLastCollectionId(c.id).catch((e: unknown) => console.error(e))
      if (token !== loadToken || rev !== revision) return true
      swap(c, photos, false)
      return true
    }

    const importInto = async (files: File[]) => {
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
      return { failed, photoIds: imported.map((p) => p.id) }
    }

    return {
      collection: emptyCollection([]),
      photos: {},
      activeFrameId: null,
      mode: 'browse',
      selectedLayerId: null,
      replacing: false,
      saveStatus: 'saved',
      savedSizes: [],
      folders: [],
      loadFailed: false,
      storageBlocked: false,

      async bootstrap() {
        set({ loadFailed: false })
        try {
          const token = loadToken
          const [sizes, folders] = await Promise.all([store.listSizes(), store.listFolders()])
          set({ savedSizes: sizes, folders })
          // Nothing is opened: the app starts on the list. A draft that was not touched gets a free name.
          if (token === loadToken && revision === queuedRevision) await startDraft()
        } catch (e) {
          console.error(e)
          set({ loadFailed: true })
        }
      },

      async openCollection(id) {
        // Photos still being read land in the collection that is open now.
        await imports
        if (!(await flushSave())) return false
        return load(() => store.getCollection(id))
      },

      async newCollection() {
        // Leaving a collection that could not be saved would lose it.
        await imports
        if (!(await flushSave())) throw new Error('The collection could not be saved')
        const c = emptyCollection((await store.listCollections()).map((x) => x.name))
        swap(c, {}, true)
        if (!(await flushSave())) throw new Error('The collection could not be saved')
        await store.setLastCollectionId(c.id).catch((e: unknown) => console.error(e))
        return c.id
      },

      async closeCollection() {
        await imports
        for (;;) {
          if (!(await flushSave())) throw new Error('The collection could not be saved')
          // Another collection opened meanwhile stays open; an edit to this one is saved first.
          if ((await startDraft()) !== 'edited') return
        }
      },

      async renameCollectionById(id, name) {
        await imports
        if (get().collection.id === id) {
          get().renameCollection(name)
          return
        }
        const c = await store.getCollection(id)
        if (!c) throw new Error('missing')
        await store.saveCollection({ ...c, name, updatedAt: Date.now() })
      },

      async duplicateCollection(id) {
        await imports
        if (!(await flushSave())) throw new Error('The collection could not be saved')
        const c = await store.getCollection(id)
        if (!c) throw new Error('missing')
        const taken = (await store.listCollections()).map((x) => x.name)
        const copy = copyCollection(
          c,
          uniqueName(t('collection.copyName', { name: c.name }), taken),
        )
        await store.duplicateCollection(id, copy)
        return copy.id
      },

      flush: async () => {
        await flushSave()
      },

      renameCollection(name) {
        commit({ collection: { ...get().collection, name } })
      },

      async listCollections() {
        await flushSave()
        return newestFirst(await store.listCollections())
      },

      async deleteCollection(id) {
        // A photo being read may be stored only under this collection until it lands in the open one.
        await imports
        if (get().collection.id !== id) {
          await flushSave()
        } else {
          // Its unsaved edits go with it, so a full device cannot block freeing space.
          clearTimeout(timer)
          timer = undefined
          queuedRevision = revision
          await queue
          await startDraft(id, false)
          // Opened again while the draft was starting: it is on screen, so it stays.
          if (get().collection.id === id) throw new Error('The collection was opened again')
        }
        await store.deleteCollection(id)
      },

      async exportActive() {
        if (!(await flushSave())) throw new Error('The collection could not be saved')
        return exportBundle(store, get().collection.id)
      },

      async importCollection(file) {
        const imported = await importBundle(store, file)
        if (!(await get().openCollection(imported.id))) throw new ImportNotOpenedError()
      },

      addPhotos(files) {
        const work = importInto(files)
        imports = Promise.all([imports, work.catch(() => undefined)])
        return work
      },

      async deletePhoto(photoId) {
        const { collection, photos } = get()
        commit({
          collection: {
            ...collection,
            photoIds: collection.photoIds.filter((id) => id !== photoId),
            frames: collection.frames.map((f) => removePhotoLayers(f, photoId, photos)),
          },
          photos: Object.fromEntries(Object.entries(photos).filter(([id]) => id !== photoId)),
        })
        // The file goes last: until the save lands, the collection on disk still points at it.
        await imports
        if (!(await flushSave()) || get().collection.photoIds.includes(photoId)) return
        await store.deletePhotoIfUnused(photoId).catch((e: unknown) => console.error(e))
      },

      async deletePhotos(photoIds) {
        for (const id of photoIds) await get().deletePhoto(id)
      },

      tapPhoto(photoId, onlyOnFrameId) {
        const frame = active()
        const photo = get().photos[photoId]
        if (!frame || !photo) return
        if (onlyOnFrameId !== undefined && frame.id !== onlyOnFrameId) return
        const { selectedLayerId, replacing, mode } = get()
        if (replacing && selectedLayerId) {
          updateActive((f) => replaceLayerPhoto(f, selectedLayerId, photo))
          commit({ replacing: false })
          return
        }
        const placed = placePhoto(frame, photo)
        const added = frame.layers.length > 0 && (onlyOnFrameId === undefined || mode === 'edit')
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

      framesForPhotos(size, photoIds) {
        const { photos, collection } = get()
        const added = photoIds
          .map((id) => photos[id])
          .filter((p): p is Photo => p !== undefined)
          .map((photo) => placePhoto(createFrame(size), photo))
        if (added.length === 0) return
        commit({ mode: 'browse', selectedLayerId: null, replacing: false })
        setFrames([...collection.frames, ...added], added[0]!.id)
      },

      addFrames(size, count) {
        const added = Array.from({ length: Math.max(0, Math.floor(count)) }, () =>
          createFrame(size),
        )
        if (added.length === 0) return
        setFrames([...get().collection.frames, ...added], added[0]!.id)
      },

      duplicateFrames(ids) {
        const frames: Frame[] = []
        let first: string | null = null
        for (const frame of get().collection.frames) {
          frames.push(frame)
          if (!ids.includes(frame.id)) continue
          const copy = duplicateFrame(frame)
          frames.push(copy)
          first ??= copy.id
        }
        if (first) setFrames(frames, first)
      },

      removeFrames(ids) {
        const { collection, activeFrameId } = get()
        const frames = collection.frames
        const rest = frames.filter((f) => !ids.includes(f.id))
        if (rest.length === frames.length) return
        const keep = (id: string | null) => rest.find((f) => f.id === id)?.id
        // The active frame if it stays, else the nearest one after it, else before it.
        const at = frames.findIndex((f) => f.id === activeFrameId)
        const after = frames.slice(at + 1).find((f) => !ids.includes(f.id))
        const before = frames
          .slice(0, Math.max(at, 0))
          .reverse()
          .find((f) => !ids.includes(f.id))
        const next = keep(activeFrameId) ?? after?.id ?? before?.id ?? rest[0]?.id ?? null
        commit({ mode: 'browse', selectedLayerId: null, replacing: false })
        setFrames(rest, next)
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

      zoomSelected(factor) {
        const id = get().selectedLayerId
        if (id) updateActive((f, photos) => zoomLayer(f, id, factor, photos))
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
        const frame = active()
        const { collection, photos, selectedLayerId } = get()
        if (!frame || !selectedLayerId) return
        const updated = removeLayer(frame, selectedLayerId, photos)
        commit({
          collection: {
            ...collection,
            frames: collection.frames.map((f) => (f.id === frame.id ? updated : f)),
          },
          // Editing carries on with the new top layer; with none left, commit returns to browse.
          selectedLayerId: updated.layers.at(-1)?.id ?? null,
        })
      },

      setPaper(p) {
        const { collection } = get()
        commit({ collection: { ...collection, paper: { ...collection.paper, ...p } } })
      },

      async saveSize(name, size, folderId) {
        const saved: SavedSize = {
          id: crypto.randomUUID(),
          name,
          ...size,
          ...(folderId ? { folderId } : {}),
        }
        await store.saveSize(saved)
        set((s) => ({ savedSizes: [...s.savedSizes, saved] }))
      },

      async updateSize(id, patch) {
        const current = get().savedSizes.find((x) => x.id === id)
        if (!current) throw new Error('missing')
        const rest: SavedSize = { ...current }
        delete rest.folderId
        const folderId = 'folderId' in patch ? patch.folderId : current.folderId
        const updated: SavedSize = {
          ...rest,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(folderId ? { folderId } : {}),
        }
        await store.saveSize(updated)
        set((s) => ({ savedSizes: s.savedSizes.map((x) => (x.id === id ? updated : x)) }))
      },

      async saveFolder(name) {
        const folder: SizeFolder = { id: crypto.randomUUID(), name, createdAt: Date.now() }
        await store.saveFolder(folder)
        set((s) => ({ folders: [...s.folders, folder] }))
        return folder
      },

      async renameFolder(id, name) {
        const current = get().folders.find((f) => f.id === id)
        if (!current) throw new Error('missing')
        const updated = { ...current, name }
        await store.saveFolder(updated)
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? updated : f)) }))
      },

      async deleteFolder(id) {
        await store.deleteFolder(id)
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          savedSizes: s.savedSizes.map(({ folderId, ...size }) =>
            folderId === id ? size : { ...size, ...(folderId ? { folderId } : {}) },
          ),
        }))
      },

      async deleteSize(id) {
        await store.deleteSize(id)
        set((s) => ({ savedSizes: s.savedSizes.filter((x) => x.id !== id) }))
      },

      async reloadFromStore(changedIds) {
        const [sizes, folders] = await Promise.all([store.listSizes(), store.listFolders()])
        set({ savedSizes: sizes, folders })
        const { collection, saveStatus } = get()
        if (!changedIds.includes(collection.id)) return
        // An edit not yet on disk wins: once saved it is dirty, and the next pass sorts it out.
        if (revision !== queuedRevision || saveStatus !== 'saved') return
        const token = loadToken
        const rev = revision
        const c = await store.getCollection(collection.id)
        if (token !== loadToken || rev !== revision) return
        if (!c) {
          await startDraft()
          return
        }
        const photos = c.photoIds.length > 0 ? await store.getPhotosMeta(c.photoIds) : {}
        if (token !== loadToken || rev !== revision) return
        base = { id: c.id, updatedAt: c.updatedAt }
        loading = true
        try {
          // commit keeps the active frame, selection and mode where they still exist.
          commit({ collection: c, photos })
        } finally {
          loading = false
        }
      },
    }
  })

  /**
   * Saves the current collection now, after any save already in flight, if it changed
   * since the last save was queued. Resolves true when the current collection is safely
   * stored (a failed save is retried by the next call, since it stays dirty).
   */
  async function flushSave(): Promise<boolean> {
    // Repeats for an edit made while waiting: callers replace the collection right after this.
    do {
      await saveOnce()
    } while (editor.getState().saveStatus !== 'full' && revision !== queuedRevision)
    return editor.getState().saveStatus !== 'full'
  }

  async function saveOnce(): Promise<void> {
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
          const from = base?.id === snapshot.id ? base : undefined
          const outcome = await store.saveCollection(
            snapshot,
            from ? { baseUpdatedAt: from.updatedAt } : undefined,
          )
          // What is stored now is this snapshot: the next edit builds on it.
          if (from && base === from) base = { id: snapshot.id, updatedAt: snapshot.updatedAt }
          if (outcome !== 'saved') {
            useSyncStatus.setState((s) => ({
              changeCount: s.changeCount + 1,
              changedIds: [outcome.conflictCopyId],
            }))
          }
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
  }

  editor.subscribe((s, prev) => {
    if (loading || s.collection === prev.collection) return
    revision++
    editor.setState({ saveStatus: 'saving' })
    clearTimeout(timer)
    timer = setTimeout(() => void saveOnce(), AUTOSAVE_DELAY_MS)
  })

  return editor
}

/** The app talks to IndexedDB, opened on first use so importing this module has no side effects. */
const lazyIdbStore = () =>
  reopeningStore(async () => {
    const opened = await createIdbStore('collage', {
      onBlocked: () => getAppStore().setState({ storageBlocked: true }),
    })
    if (getAppStore().getState().storageBlocked) getAppStore().setState({ storageBlocked: false })
    return opened
  })

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

/** The app's editor store itself, for code outside React that follows its changes (the sync). */
export function appEditor(): StoreApi<EditorState> {
  return getAppStore()
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(getAppStore(), selector)
}

/** The state right now, for code that runs after an await and must not read a stale render. */
export function getEditorState(): EditorState {
  return getAppStore().getState()
}
