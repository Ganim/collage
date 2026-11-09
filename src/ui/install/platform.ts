const DISMISSED_KEY = 'collage.installHintDismissed'

export interface InstallEnv {
  ua: string
  standalone: boolean
  dismissed: boolean
}

/** On the iPhone only Safari reliably offers "Add to Home Screen"; app browsers do not. */
export function shouldSuggestInstall({ ua, standalone, dismissed }: InstallEnv): boolean {
  if (standalone || dismissed) return false
  return /iPhone|iPod/.test(ua) && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null
  } catch {
    return false
  }
}

export function readInstallEnv(): InstallEnv {
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    ua: navigator.userAgent,
    standalone: legacy || matchMedia('(display-mode: standalone)').matches,
    dismissed: wasDismissed(),
  }
}

export function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Private tabs may refuse: the suggestion just comes back on the next visit.
  }
}
