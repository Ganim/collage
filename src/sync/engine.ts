import type { Collection } from '../core/types'
import { decodeImage, type Decode } from '../photos/import'
import type { Owner, Store, Tombstone } from '../storage/store'
import { t } from '../ui/i18n'
import { DriveError, RATE_LIMIT_REASONS, type Drive, type RemoteFile } from './drive'
import {
  forgetCollectionDeletion,
  forgetCollectionDetachment,
  mergeLibrary,
  recordCollectionDetachment,
} from './library'
import { md5 } from './md5'
import { planCollections, type Action } from './plan'
import {
  canonical,
  deletionTimes,
  failureStatus,
  fitAppProperties,
  indexListing,
  isCollection,
  isEmptyLibrary,
  toLibrary,
  type Listing,
} from './remote'
import { useSyncStatus, type SyncStatus } from './status'

export interface SyncEngine {
  /**
   * One full pass; concurrent calls join the running pass (and its priority). Never rejects:
   * failures go to the status. `priority` orders the photo downloads, as in downloadMissingPhotos.
   */
  run(priority?: string[]): Promise<void>
  /**
   * Downloads the photos that local collections use and this device lacks. `priority` holds photo
   * ids or collection ids (meaning their photos), fetched first in that order.
   */
  downloadMissingPhotos(priority?: string[]): Promise<void>
  /**
   * Stops the running pass and downloads at their next wait for the store, the Drive or a decode;
   * they write nothing more, the status included. A later run starts afresh.
   */
  cancel(): void
}

export interface SyncEngineDeps {
  store: Store
  drive: Drive
  decode?: Decode
  now?: () => number
}

/**
 * What the pass knows of the collection files on the Drive: the photo ids of each file it read or
 * wrote, by file id, and the files it trashed. Feeds the photo cleanup after a removal.
 */
interface Seen {
  photos: Map<string, string[]>
  trashed: Set<string>
}

/** What a pass changed on this device: collection ids, and whether sizes or folders. */
interface Changes {
  ids: Set<string>
  library: boolean
}

const LIBRARY_NAME = 'library.json'

/** Forgets the collection's Drive file, as a setSyncState patch. */
const FORGET_FILE = { remoteFileId: undefined, remoteVersion: undefined, remoteMd5: undefined }

/** A photo download that will not work on any retry: the file is gone or refused to us. */
function isSkippablePhotoError(e: unknown): boolean {
  if (!(e instanceof DriveError) || e.kind !== 'other') return false
  if (e.status === 404) return true
  return e.status === 403 && !RATE_LIMIT_REASONS.has(e.reason ?? '')
}
const jsonBlob = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/** Thrown inside a pass that was cancelled; never reaches the status. */
class Cancelled extends Error {
  constructor() {
    super('Sync pass cancelled')
    this.name = 'Cancelled'
  }
}

/** `promise`, then `check()` once it settles: a cancelled pass stops at that point. */
function checked<T>(promise: Promise<T>, check: () => void): Promise<T> {
  return promise.then(
    (value) => {
      check()
      return value
    },
    (e: unknown) => {
      check()
      throw e
    },
  )
}

/** `target` whose every method runs `check()` before it starts and after its promise settles. */
function guarded<T extends object>(target: T, check: () => void): T {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        check()
        const result: unknown = Reflect.apply(value, object, args)
        return result instanceof Promise ? checked(result, check) : result
      }
    },
  })
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  /** Bumped by cancel(): work begun under an older generation stops. */
  let generation = 0
  let running: Promise<void> | null = null
  let photoQueue: Promise<unknown> = Promise.resolve()

  /** The engine's work, bound to the current generation. */
  function scoped() {
    const mine = generation
    const check = () => {
      if (generation !== mine) throw new Cancelled()
    }
    const store = guarded(deps.store, check)
    const drive = guarded(deps.drive, check)
    const baseDecode = deps.decode ?? decodeImage
    const decode: Decode = (file) => checked(baseDecode(file), check)
    const now = deps.now ?? Date.now
    const setStatus = (
      patch: Partial<SyncStatus> | ((s: SyncStatus) => Partial<SyncStatus>),
    ): void => {
      if (generation === mine) useSyncStatus.setState(patch)
    }

    function publish(changed: Set<string>, force = false): void {
      if (changed.size === 0 && !force) return
      setStatus((s) => ({ changeCount: s.changeCount + 1, changedIds: [...changed].sort() }))
    }

    async function listFolder(): Promise<Listing> {
      const folder = await drive.ensureFolder()
      return indexListing(folder, await drive.list(folder))
    }

    async function readJson(fileId: string): Promise<unknown> {
      const text = await (await drive.download(fileId)).text()
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined
      }
    }

    /** Uploads the photos the Drive does not have yet; a photo missing here is skipped. */
    async function uploadPhotos(photoIds: string[], listing: Listing): Promise<void> {
      for (const photoId of new Set(photoIds)) {
        if (listing.photos.has(photoId)) continue
        const p = await store.getPhoto(photoId)
        if (!p) continue
        const file = await drive.create(
          listing.folder,
          `photo-${photoId}`,
          p.original,
          fitAppProperties({
            kind: 'photo',
            photoId,
            name: p.name,
            width: String(p.width),
            height: String(p.height),
          }),
        )
        listing.photos.set(photoId, file)
      }
    }

    /**
     * Photos first, then the collection file, then the local record: a pass cut short anywhere
     * leaves the collection dirty, and the next one finds the photos already up.
     */
    async function push(
      id: string,
      owner: Owner,
      listing: Listing,
      remote: Map<string, RemoteFile>,
      seen: Seen,
    ): Promise<void> {
      const c = await store.getCollection(id)
      if (!c) return
      const state = (await store.getSyncStates())[id]
      if (state?.ownerId === undefined) {
        await store.setSyncState(id, {
          ownerId: owner.id,
          ownerEmail: owner.email,
          dirty: state?.dirty ?? true,
        })
      }
      await uploadPhotos(c.photoIds, listing)
      const existing = remote.get(id)
      // The exact text uploaded: its MD5 is how a later pass recognizes it on the Drive.
      const text = JSON.stringify(c)
      const body = new Blob([text], { type: 'application/json' })
      const file = existing
        ? await drive.update(existing.id, body)
        : await drive.create(
            listing.folder,
            `collection-${id}.json`,
            body,
            fitAppProperties({ kind: 'collection', collectionId: id }),
          )
      remote.set(id, file)
      seen.photos.set(file.id, c.photoIds)
      await store.markPushed(id, c.updatedAt, file.id, file.version, md5(text))
      // Deleted during its first upload: no tombstone knows this file, so it goes now.
      if (!existing && !(await store.getCollection(id))) {
        await drive.trash(file.id)
        seen.trashed.add(file.id)
        remote.delete(id)
      }
    }

    async function pull(
      action: Extract<Action, { kind: 'pull' }>,
      owner: Owner,
      changed: Set<string>,
      seen: Seen,
    ): Promise<void> {
      const c = await readJson(action.fileId)
      if (!isCollection(c, action.id)) return
      seen.photos.set(action.fileId, c.photoIds)
      // The store skips a collection edited here since the plan: the next pass sees a conflict.
      const wrote = await store.putRemoteCollection(c, {
        ownerId: owner.id,
        ownerEmail: owner.email,
        remoteFileId: action.fileId,
        remoteVersion: action.version,
        dirty: false,
      })
      if (wrote) changed.add(action.id)
    }

    /** Keeps the Drive's version as a new collection, then uploads the local one over it. */
    async function resolveConflict(
      action: Extract<Action, { kind: 'conflict' }>,
      owner: Owner,
      listing: Listing,
      remote: Map<string, RemoteFile>,
      changed: Set<string>,
      seen: Seen,
    ): Promise<void> {
      const theirs = await readJson(action.fileId)
      const mine = await store.getCollection(action.id)
      if (isCollection(theirs, action.id)) seen.photos.set(action.fileId, theirs.photoIds)
      if (mine && isCollection(theirs, action.id)) {
        if (canonical(theirs) === canonical(mine)) {
          // Same content (an upload whose record never got written): just adopt the file.
          // The Drive's checksum names this content now: keep it, so a later metadata-only
          // version is no conflict.
          const md5Checksum = remote.get(action.id)?.md5Checksum
          await store.markPushed(
            action.id,
            mine.updatedAt,
            action.fileId,
            action.version,
            md5Checksum,
          )
          return
        }
        const copy: Collection = {
          ...theirs,
          id: crypto.randomUUID(),
          name: theirs.name + t('sync.conflictSuffix'),
        }
        // Recording the seen version makes a retry of this pass a plain push, not a second copy.
        await store.saveConflictCopy(copy, action.id, action.fileId, action.version)
        changed.add(copy.id)
        await push(action.id, owner, listing, remote, seen)
        await push(copy.id, owner, listing, remote, seen)
        return
      }
      // The Drive's file is not a readable collection: the local version replaces it.
      await push(action.id, owner, listing, remote, seen)
    }

    /** Library merge and every collection action, noting in `changes` what changed locally. */
    async function syncData(owner: Owner, listing: Listing, changes: Changes): Promise<void> {
      const changed = changes.ids
      const tombstones = await store.listTombstones()
      const fileIds = new Set([...listing.collections.values()].flat().map((f) => f.id))
      // Ruling: only deletions of files this account can see are acted on; others stay untouched.
      const collectionTombs = tombstones.filter(
        (t) =>
          t.kind === 'collection' && t.remoteFileId !== undefined && fileIds.has(t.remoteFileId),
      )
      const libraryTombs = tombstones.filter((t) => t.kind !== 'collection')

      // 1. Library: merge, apply locally.
      const remoteLibrary = listing.library ? toLibrary(await readJson(listing.library.id)) : null
      const [sizes, folders] = await Promise.all([store.listSizes(), store.listFolders()])
      let library = mergeLibrary(
        {
          sizes,
          folders,
          deleted: {
            size: deletionTimes(libraryTombs.filter((t) => t.kind === 'size')),
            folder: deletionTimes(libraryTombs.filter((t) => t.kind === 'folder')),
            collection: deletionTimes(collectionTombs),
          },
          detached: { collection: {} },
        },
        remoteLibrary,
      )
      if (
        canonical({ sizes, folders }) !==
        canonical({ sizes: library.sizes, folders: library.folders })
      ) {
        await store.putRemoteLibrary(library.sizes, library.folders)
        changes.library = true
      }

      // 2. Collections.
      const [summaries, states] = await Promise.all([
        store.listCollections(),
        store.getSyncStates(),
      ])
      const local = Object.fromEntries(
        summaries.map((s) => [s.id, states[s.id] ?? { dirty: true }]),
      )
      const allTombs = new Map(
        tombstones.filter((t) => t.kind === 'collection').map((t) => [t.id, t]),
      )
      const remote = new Map<string, RemoteFile>()
      for (const [id, files] of listing.collections) {
        const known = allTombs.get(id)?.remoteFileId ?? states[id]?.remoteFileId
        remote.set(id, files.find((f) => f.id === known) ?? files[0]!)
      }
      const actions = planCollections({
        local,
        remote: Object.fromEntries(
          [...remote].map(([id, f]) => [
            id,
            { fileId: f.id, version: f.version, md5: f.md5Checksum },
          ]),
        ),
        remoteDeleted: remoteLibrary?.deleted.collection ?? {},
        localTombstones: [...allTombs.values()],
        remoteDetached: remoteLibrary?.detached.collection ?? {},
      })

      const seen: Seen = { photos: new Map(), trashed: new Set() }
      const toTrash: Extract<Action, { kind: 'trashRemote' }>[] = []
      const toDetach: Extract<Action, { kind: 'detachRemote' }>[] = []
      const cleared: { kind: Tombstone['kind']; id: string }[] = libraryTombs.map(
        ({ kind, id }) => ({
          kind,
          id,
        }),
      )
      for (const action of actions) {
        switch (action.kind) {
          case 'push':
            await push(action.id, owner, listing, remote, seen)
            break
          case 'pull':
            await pull(action, owner, changed, seen)
            break
          case 'conflict':
            await resolveConflict(action, owner, listing, remote, changed, seen)
            break
          case 'deleteLocal':
            // Edited since the plan: kept, and the next pass pushes it back (push + forget).
            if (await store.removeLocalCollection(action.id, { onlyIfClean: true }))
              changed.add(action.id)
            break
          case 'trashRemote':
            toTrash.push(action)
            break
          case 'forgetTombstone': {
            const tomb = allTombs.get(action.id)
            // A tombstone whose file is simply gone stays (ruling 6); one shadowed by a newer
            // file of the same collection is dropped, or that file would never come down.
            if (tomb && !remote.has(action.id)) break
            library = forgetCollectionDeletion(library, action.id)
            if (tomb) cleared.push({ kind: 'collection', id: action.id })
            break
          }
          case 'detachRemote':
            // Recorded now and published below, before the file goes to the trash.
            library = recordCollectionDetachment(library, action.id, now())
            toDetach.push(action)
            break
          case 'markLocalOnly':
            // Removed from the Drive elsewhere: kept here, out of the sync.
            await store.setSyncState(action.id, { localOnly: true, ...FORGET_FILE })
            changed.add(action.id)
            break
          case 'forgetDetached':
            // Planned after its push: the collection is on the Drive again.
            library = forgetCollectionDetachment(library, action.id)
            break
        }
      }

      // 3. Publish the library before trashing, so a trashed file always has its deletion record.
      const changedRemotely = remoteLibrary
        ? canonical(library) !== canonical(remoteLibrary)
        : !isEmptyLibrary(library)
      if (changedRemotely || (listing.library && !remoteLibrary)) {
        if (listing.library) await drive.update(listing.library.id, jsonBlob(library))
        else
          await drive.create(listing.folder, LIBRARY_NAME, jsonBlob(library), { kind: 'library' })
      }
      if (cleared.length > 0) await store.clearTombstones(cleared)
      await store.setLibraryDirty(false)

      for (const action of toTrash) {
        await drive.trash(action.fileId)
        seen.trashed.add(action.fileId)
        await store.clearTombstones([{ kind: 'collection', id: action.id }])
      }

      if (toDetach.length === 0) return
      for (const action of toDetach) {
        await drive.trash(action.fileId)
        seen.trashed.add(action.fileId)
        // Only now: a pass cut short before this plans the removal again.
        await store.setSyncState(action.id, FORGET_FILE)
      }
      await trashUnusedPhotos(
        toDetach.map((a) => a.id),
        listing,
        remote,
        seen,
      )
    }

    /**
     * After a removal from the Drive: trashes each photo of the removed collections that no
     * collection left in the sync uses, that is, no local collection of this account that is not
     * local-only, and no collection file still on the Drive. A Drive file's photos are known when
     * this pass read or wrote it, or when the local copy is clean and records exactly that file and
     * version; nothing is downloaded for this. Any other file (another device's collection not
     * pulled here, a second file of an id) could use any photo, so then this pass trashes none and
     * those photos stay on the Drive. Photos never leave a device.
     */
    async function trashUnusedPhotos(
      detached: string[],
      listing: Listing,
      remote: Map<string, RemoteFile>,
      seen: Seen,
    ): Promise<void> {
      const [summaries, states] = await Promise.all([
        store.listCollections(),
        store.getSyncStates(),
      ])
      const photosOf = async (id: string) => (await store.getCollection(id))?.photoIds ?? []

      // Every collection file left on the Drive, at its newest known version.
      const files = new Map<string, { id: string; version: string }>()
      for (const [id, list] of listing.collections)
        for (const f of list) files.set(f.id, { id, version: f.version })
      for (const [id, f] of remote) files.set(f.id, { id, version: f.version })

      const used = new Set<string>()
      for (const [fileId, { id, version }] of files) {
        if (seen.trashed.has(fileId)) continue
        const state = states[id]
        const known =
          seen.photos.get(fileId) ??
          (state &&
          !state.dirty &&
          !state.localOnly &&
          state.remoteFileId === fileId &&
          state.remoteVersion === version
            ? await photosOf(id)
            : undefined)
        if (!known) return
        for (const p of known) used.add(p)
      }
      for (const { id, localOnly } of summaries) {
        if (!localOnly) for (const p of await photosOf(id)) used.add(p)
      }

      for (const photoId of new Set((await Promise.all(detached.map(photosOf))).flat())) {
        const file = listing.photos.get(photoId)
        if (!file || used.has(photoId)) continue
        try {
          await drive.trash(file.id)
        } catch (e) {
          // Already gone since the listing: nothing left to trash.
          if (!(e instanceof DriveError && e.status === 404)) throw e
        }
        listing.photos.delete(photoId)
      }
    }

    /** The photo ids to fetch, in order: priority first (a collection id stands for its photos). */
    async function missingPhotos(
      listing: Listing,
      priority: string[],
    ): Promise<{ order: string[]; usedBy: Map<string, string[]> }> {
      const usedBy = new Map<string, string[]>()
      const byCollection = new Map<string, string[]>()
      for (const { id } of await store.listCollections()) {
        const photoIds = (await store.getCollection(id))?.photoIds ?? []
        byCollection.set(id, photoIds)
        for (const photoId of photoIds) usedBy.set(photoId, [...(usedBy.get(photoId) ?? []), id])
      }
      const have = await store.getPhotosMeta([...usedBy.keys()])
      const missing = [...usedBy.keys()].filter((p) => !have[p] && listing.photos.has(p))
      const missingSet = new Set(missing)
      const first = priority
        .flatMap((id) => byCollection.get(id) ?? [id])
        .filter((p) => missingSet.has(p))
      return { order: [...new Set([...first, ...missing])], usedBy }
    }

    async function fetchPhotos(listing: Listing, priority: string[]): Promise<void> {
      const { order, usedBy } = await missingPhotos(listing, priority)
      if (order.length === 0) return
      const changed = new Set<string>()
      const total = order.length
      setStatus({ photos: { done: 0, total } })
      try {
        for (const [i, photoId] of order.entries()) {
          const file = listing.photos.get(photoId)!
          let original: Blob
          try {
            original = await drive.download(file.id)
          } catch (e) {
            // Gone since the listing, or refused for good for this one file: skipped. Anything
            // else (5xx, 429, a rate limit, offline, lost access) stops the pass so the next one
            // tries again.
            if (!isSkippablePhotoError(e)) throw e
            setStatus({ photos: { done: i + 1, total } })
            continue
          }
          const name = file.appProperties.name || photoId
          let decoded: Awaited<ReturnType<Decode>> | undefined
          try {
            decoded = await decode(new File([original], name, { type: original.type }))
          } catch {
            // An unreadable image is skipped like a missing one; the collection still opens.
          }
          if (decoded) {
            await store.putPhoto({
              id: photoId,
              name,
              width: decoded.width,
              height: decoded.height,
              original,
              preview: decoded.preview,
              thumb: decoded.thumb,
            })
            for (const id of usedBy.get(photoId) ?? []) changed.add(id)
          }
          setStatus({ photos: { done: i + 1, total } })
        }
      } finally {
        setStatus({ photos: undefined })
        publish(changed)
      }
    }

    /** One photo download at a time, so two callers never fetch the same file twice. */
    function queuePhotos(listing: Listing, priority: string[]): Promise<void> {
      const next = photoQueue.then(() => fetchPhotos(listing, priority))
      photoQueue = next.catch(() => {})
      return next
    }

    async function pass(priority: string[]): Promise<void> {
      try {
        const owner = await store.getOwner()
        if (!owner) {
          setStatus({ state: 'off', error: undefined, photos: undefined })
          return
        }
        setStatus({ state: 'syncing', error: undefined })
        const listing = await listFolder()
        const changes: Changes = { ids: new Set(), library: false }
        try {
          await syncData(owner, listing, changes)
        } finally {
          publish(changes.ids, changes.library)
        }
        await queuePhotos(listing, priority)
        setStatus({ state: 'idle', error: undefined, lastSyncedAt: now(), photos: undefined })
      } catch (e) {
        fail(e)
      }
    }

    async function downloadMissingPhotos(priority: string[]): Promise<void> {
      try {
        if (!(await store.getOwner())) return
        await queuePhotos(await listFolder(), priority)
      } catch (e) {
        fail(e)
      }
    }

    function fail(e: unknown): void {
      if (e instanceof Cancelled || generation !== mine) return
      setStatus({ ...failureStatus(e), photos: undefined })
    }

    return { pass, downloadMissingPhotos }
  }

  return {
    run(priority = []) {
      if (!running) {
        const current: Promise<void> = scoped()
          .pass(priority)
          .finally(() => {
            if (running === current) running = null
          })
        running = current
      }
      return running
    },

    downloadMissingPhotos(priority = []) {
      return scoped().downloadMissingPhotos(priority)
    },

    cancel() {
      generation++
      running = null
    },
  }
}
