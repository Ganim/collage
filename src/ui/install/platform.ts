const DISMISSED_KEY = 'collage.installHintDismissed'
const DISMISSAL_MS = 24 * 60 * 60 * 1000

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

/** A dismissal only lasts a day: outside the installed app her collections are at risk. */
export function isDismissalActive(stored: string | null, now: number): boolean {
  if (stored === null) return false
  return now - Number(stored) < DISMISSAL_MS
}

function wasDismissed(): boolean {
  try {
    return isDismissalActive(localStorage.getItem(DISMISSED_KEY), Date.now())
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
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {
    // Private tabs may refuse: the suggestion just comes back on the next visit.
  }
}
