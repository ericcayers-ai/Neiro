import { useCallback, useEffect, useRef, useState } from 'react'

import {
  addLibraryClip,
  addLibraryMarker,
  addLibrarySong,
  addToLibraryPlaylist,
  deleteLibrarySong,
  getLibrarySong,
  libraryAudioUrl,
  listLibraryPlaylists,
  addLibraryVersion,
  listLibrarySongs,
  markSongPlayed,
  resetLibrary,
  saveSongSettings,
  saveLibraryNotes,
} from '../api/client'
import type { LibraryPlaylist, LibrarySong } from '../api/types'
import { PlayerSurface } from '../player/PlayerSurface'
import { libraryWrites, playerStorageKey, readPlayerArtifacts } from '../player/librarySync'
import type { PlayerParams } from '../player/params'
import { useSession } from '../state/session'
import { ModuleHeader } from '../components/ModuleHeader'
import { MidiTargets } from '../library/MidiTargets'
import { usePlural, useT } from '../i18n'

const NOTES_LIMIT = 5000

export function LibraryModule() {
  const { file, pendingSongId, clearPendingSong } = useSession()
  const t = useT()
  const plural = usePlural()
  const [songs, setSongs] = useState<LibrarySong[]>([])
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([])
  const [selected, setSelected] = useState<LibrarySong | null>(null)
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [markerTime, setMarkerTime] = useState('0')
  const [markerLabel, setMarkerLabel] = useState('')
  const [clipStart, setClipStart] = useState('0')
  const [clipEnd, setClipEnd] = useState('4')
  const settingsTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, lists] = await Promise.all([listLibrarySongs(), listLibraryPlaylists()])
      setSongs(list.songs)
      setPlaylists(lists.playlists)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!pendingSongId) return
    const match = songs.find((song) => song.id === pendingSongId)
    if (!match) return
    void openSong(match)
    clearPendingSong()
  }, [pendingSongId, songs, clearPendingSong])

  const openSong = async (song: LibrarySong) => {
    setSelected(song)
    setNotes(song.notes || '')
    void markSongPlayed(song.id).catch(() => undefined)
    try {
      const detail = await getLibrarySong(song.id)
      setSelected(detail.song)
      setNotes(detail.song.notes || '')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const addCurrent = async () => {
    if (!file) {
      setMessage('Open a file first, then add it to the library.')
      return
    }
    setBusy(true)
    try {
      const result = await addLibrarySong({ file_id: file.fileId, title: file.name })
      setMessage(`Added “${result.song.title}”.`)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveNotes = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await saveLibraryNotes(selected.id, notes)
      setMessage(t('library.notesSaved'))
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const addMarker = async () => {
    if (!selected) return
    try {
      await addLibraryMarker(selected.id, Number(markerTime) || 0, markerLabel)
      setMarkerLabel('')
      const detail = await getLibrarySong(selected.id)
      setSelected(detail.song)
      setMessage(t('library.markerAdded'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const addClip = async () => {
    if (!selected) return
    try {
      await addLibraryClip(selected.id, {
        name: `Clip ${clipStart}–${clipEnd}`,
        start: Number(clipStart) || 0,
        end: Number(clipEnd) || 4,
      })
      const detail = await getLibrarySong(selected.id)
      setSelected(detail.song)
      setMessage(t('library.clipAdded'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const persistPlayerSettings = (params: PlayerParams) => {
    if (!selected) return
    if (settingsTimer.current) window.clearTimeout(settingsTimer.current)
    settingsTimer.current = window.setTimeout(() => {
      void saveSongSettings(selected.id, { ...(selected.settings ?? {}), player: params })
        .then(() => setMessage(t('library.settingsSaved')))
        .catch((err: unknown) =>
          setMessage(err instanceof Error ? err.message : String(err)),
        )
    }, 800)
  }

  const importPlayerData = async () => {
    if (!selected) return
    const artifacts = readPlayerArtifacts(localStorage.getItem(playerStorageKey(selected.id)))
    const writes = libraryWrites(artifacts)
    if (!writes.markers.length && !writes.clips.length) {
      setMessage(t('library.noPlayerData'))
      return
    }
    setBusy(true)
    try {
      for (const marker of writes.markers) {
        await addLibraryMarker(selected.id, marker.time, marker.label)
      }
      for (const clip of writes.clips) {
        await addLibraryClip(selected.id, clip)
      }
      const detail = await getLibrarySong(selected.id)
      setSelected(detail.song)
      setMessage(
        t('library.imported', { markers: writes.markers.length, clips: writes.clips.length }),
      )
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selected) return
    if (!window.confirm(t('library.removeConfirm', { title: selected.title }))) {
      return
    }
    try {
      await deleteLibrarySong(selected.id)
      setSelected(null)
      setNotes('')
      await refresh()
      setMessage(t('library.removed'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const favorites = playlists.find((playlist) => playlist.is_default) ?? playlists[0]

  return (
    <div className="module">
      <ModuleHeader
        title={t('library.title')}
        lede={t('library.lede')}
        actions={
          <>
            <button type="button" className="primary" onClick={() => void addCurrent()} disabled={busy || !file}>
              {t('library.addCurrent')}
            </button>
            <button
              type="button"
              onClick={() => {
                const last = [...songs].sort(
                  (a, b) => (b.last_played ?? b.updated) - (a.last_played ?? a.updated),
                )[0]
                if (last) void openSong(last)
              }}
              disabled={!songs.length}
            >
              {t('library.resumeLast')}
            </button>
            <a className="btn-link" href="/api/library/export" download="neiro-library.json">
              {t('library.export')}
            </a>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(t('library.resetConfirm'))) return
                void (async () => {
                  try {
                    const result = await resetLibrary()
                    setSelected(null)
                    setNotes('')
                    await refresh()
                    setMessage(t('library.resetDone', { count: result.removed_songs }))
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : String(err))
                  }
                })()
              }}
            >
              {t('library.reset')}
            </button>
          </>
        }
      />

      {message && (
        <p className="muted" role="status" aria-live="polite">
          {message}
        </p>
      )}

      <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          <h3>{plural('library.songs', songs.length)}</h3>
          {songs.length === 0 ? (
            <p className="intent">{t('library.noSongs')}</p>
          ) : (
            <ul className="player-list" style={{ maxHeight: 420 }}>
              {songs.map((song) => (
                <li key={song.id}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void openSong(song)}
                    aria-current={selected?.id === song.id ? 'true' : undefined}
                  >
                    {song.title}
                    {song.duration ? ` · ${Math.round(song.duration)}s` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {favorites && (
            <p className="intent">
              {t('library.playlist', { name: favorites.name, count: favorites.songs.length })}
            </p>
          )}
        </div>

        <div style={{ flex: '2 1 420px', minWidth: 300 }}>
          {!selected ? (
            <p className="intent">{t('library.selectSong')}</p>
          ) : (
            <section aria-label={t('library.songAria', { title: selected.title })}>
              <h3>{selected.title}</h3>
              <p className="intent">
                {t('library.updated', {
                  path: selected.path || t('library.noPath'),
                  when: new Date(selected.updated * 1000).toLocaleString(),
                })}
              </p>

              <label className="field">
                <span>{t('library.notes', { count: notes.length, limit: NOTES_LIMIT })}</span>
                <textarea
                  rows={5}
                  maxLength={NOTES_LIMIT}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t('library.notesPlaceholder')}
                />
              </label>
              <div className="row">
                <button type="button" onClick={() => void saveNotes()} disabled={busy}>
                  {t('library.saveNotes')}
                </button>
                <button type="button" onClick={() => void remove()} disabled={busy}>
                  {t('library.remove')}
                </button>
                {favorites && (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await addToLibraryPlaylist(favorites.id, selected.id)
                          await refresh()
                          setMessage(t('library.addedToPlaylist', { name: favorites.name }))
                        } catch (err) {
                          setMessage(err instanceof Error ? err.message : String(err))
                        }
                      })()
                    }}
                  >
                    {t('library.addToPlaylist', { name: favorites.name })}
                  </button>
                )}
                <button type="button" onClick={() => void importPlayerData()} disabled={busy}>
                  {t('library.importPlayer')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const label = window.prompt(t('library.versionPrompt'), 'mix')
                    if (!label) return
                    void (async () => {
                      try {
                        await addLibraryVersion(selected.id, label)
                        const detail = await getLibrarySong(selected.id)
                        setSelected(detail.song)
                        setMessage(t('library.versionSaved', { label }))
                      } catch (err) {
                        setMessage(err instanceof Error ? err.message : String(err))
                      }
                    })()
                  }}
                  disabled={busy}
                >
                  {t('library.saveVersion')}
                </button>
              </div>

              {selected.path && (
                <PlayerSurface
                  src={libraryAudioUrl(selected.id)}
                  fileId={selected.id}
                  title={selected.title}
                  duration={selected.duration ?? undefined}
                  initialParams={selected.settings?.player as Partial<PlayerParams> | undefined}
                  onParamsChange={persistPlayerSettings}
                />
              )}

              <div className="row" style={{ marginTop: '0.8rem', alignItems: 'flex-end' }}>
                <label className="field">
                  <span>{t('library.markerTime')}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={markerTime}
                    onChange={(event) => setMarkerTime(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{t('library.markerLabel')}</span>
                  <input
                    type="text"
                    value={markerLabel}
                    onChange={(event) => setMarkerLabel(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void addMarker()}>
                  {t('library.addMarker')}
                </button>
              </div>
              <ul className="player-list">
                {(selected.markers || []).map((marker) => (
                  <li key={marker.id}>
                    <span>
                      {marker.time.toFixed(2)}s · {marker.label || t('library.markerFallback')}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="row" style={{ marginTop: '0.6rem', alignItems: 'flex-end' }}>
                <label className="field">
                  <span>{t('library.clipStart')}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={clipStart}
                    onChange={(event) => setClipStart(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{t('library.clipEnd')}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={clipEnd}
                    onChange={(event) => setClipEnd(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void addClip()}>
                  {t('library.addClip')}
                </button>
              </div>
              {(selected.versions || []).length > 0 && (
                <p className="intent">
                  {t('library.versions', {
                    labels: (selected.versions || []).map((version) => version.label).join(', '),
                  })}
                </p>
              )}
              <ul className="player-list">
                {(selected.clips || []).map((clip) => (
                  <li key={clip.id}>
                    <span>
                      {clip.name} · {clip.start.toFixed(1)}–{clip.end.toFixed(1)}s · ×{clip.loop_count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <MidiTargets />
    </div>
  )
}
