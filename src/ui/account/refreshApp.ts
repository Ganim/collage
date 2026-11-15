/** How long to wait for a new version to download before reloading anyway. */
const INSTALL_TIMEOUT_MS = 15000
/** How long to wait for the new version to take over before reloading anyway. */
const TAKEOVER_TIMEOUT_MS = 4000

function settled(worker: ServiceWorker, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (worker.state !== 'installing') return resolve()
    const timer = setTimeout(resolve, timeoutMs)
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installing') {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

function takeover(container: ServiceWorkerContainer, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    container.addEventListener('controllerchange', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Loads the newest version of the app now, instead of at the next launch: asks the server for
 * it, lets it take over and reloads. Without a new version, or without internet, it only
 * reloads. The offline copy of the app and the collections on the device are kept.
 */
export async function refreshApp(reload: () => void = () => location.reload()): Promise<void> {
  const container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined
  try {
    const registration = await container?.getRegistration()
    if (container && registration) {
      await registration.update().catch(() => undefined)
      const installing = registration.installing
      if (installing) await settled(installing, INSTALL_TIMEOUT_MS)
      const waiting = registration.waiting
      if (waiting) {
        const took = takeover(container, TAKEOVER_TIMEOUT_MS)
        // The worker the app builds waits for this message before taking over.
        waiting.postMessage({ type: 'SKIP_WAITING' })
        await took
      }
    }
  } catch (e) {
    console.error(e)
  }
  reload()
}
