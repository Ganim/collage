/** Asks the browser not to clear this site's data under storage pressure. It may say no. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch (e) {
    console.error(e)
  }
}
