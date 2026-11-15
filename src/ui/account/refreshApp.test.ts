import { refreshApp } from './refreshApp'

function fakeContainer(registration: unknown) {
  const listeners: Record<string, () => void> = {}
  const container = {
    getRegistration: vi.fn(async () => registration),
    addEventListener: (type: string, fn: () => void) => {
      listeners[type] = fn
    },
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  return listeners
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('refreshApp', () => {
  it('lets a waiting new version take over, then reloads', async () => {
    const waiting = { postMessage: vi.fn() }
    const listeners = fakeContainer({ update: vi.fn(async () => {}), installing: null, waiting })
    const reload = vi.fn()
    const done = refreshApp(reload)
    await vi.waitFor(() =>
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }),
    )
    expect(reload).not.toHaveBeenCalled()
    listeners.controllerchange!()
    await done
    expect(reload).toHaveBeenCalledOnce()
  })

  it('only reloads when there is no new version or no internet', async () => {
    fakeContainer({
      update: vi.fn(async () => {
        throw new Error('offline')
      }),
      installing: null,
      waiting: null,
    })
    const reload = vi.fn()
    await refreshApp(reload)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads where there is no service worker', async () => {
    const reload = vi.fn()
    await refreshApp(reload)
    expect(reload).toHaveBeenCalledOnce()
  })
})
