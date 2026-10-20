/** Desktop updater bridge. No-ops in a normal browser. */

export interface DesktopUpdate {
  version: string
  notes?: string
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!isTauri()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null
  return { version: update.version, notes: update.body ?? undefined }
}

/** Downloads, installs and relaunches. Returns false when no update exists. */
export async function installDesktopUpdate(
  onProgress?: (message: string) => void,
): Promise<boolean> {
  if (!isTauri()) return false
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return false
  let downloaded = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      onProgress?.('Downloading update…')
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      onProgress?.(`Downloading update… ${(downloaded / 1e6).toFixed(1)} MB`)
    } else if (event.event === 'Finished') {
      onProgress?.('Installing update…')
    }
  })
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return true
}
