import { useCallback, useEffect, useState } from 'react'

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
  saveLibraryNotes,
} from '../api/client'
import type { LibraryPlaylist, LibrarySong } from '../api/types'
import { PlayerSurface } from '../player/PlayerSurface'
import { libraryWrites, playerStorageKey, readPlayerArtifacts } from '../player/librarySync'
import { useSession } from '../state/session'
import { ModuleHeader } from '../components/ModuleHeader'

const NOTES_LIMIT = 5000

export function LibraryModule() {
  const { file } = useSession()
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
      setMessage('Notes saved.')
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
      setMessage('Marker added.')
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
      setMessage('Clip added.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const importPlayerData = async () => {
    if (!selected) return
    const artifacts = readPlayerArtifacts(localStorage.getItem(playerStorageKey(selected.id)))
    const writes = libraryWrites(artifacts)
    if (!writes.markers.length && !writes.clips.length) {
      setMessage('No player markers or clips found for this song.')
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
        `Imported ${writes.markers.length} marker(s) and ${writes.clips.length} clip(s) from the player.`,
      )
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selected) return
    if (!window.confirm(`Remove “${selected.title}” from the library? The audio file stays on disk.`)) {
      return
    }
    try {
      await deleteLibrarySong(selected.id)
      setSelected(null)
      setNotes('')
      await refresh()
      setMessage('Removed from library.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const favorites = playlists.find((playlist) => playlist.is_default) ?? playlists[0]

  return (
    <div className="module">
      <ModuleHeader
        title="Library"
        lede="Local songs, per-song notes, markers, clips and playlists. Stored in a SQLite file on this machine — no account, no cloud, no share links."
        actions={
          <>
            <button type="button" className="primary" onClick={() => void addCurrent()} disabled={busy || !file}>
              Add current file
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
              Resume last
            </button>
            <a className="btn-link" href="/api/library/export" download="neiro-library.json">
              Export JSON
            </a>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Remove every song from the library? Audio files stay on disk.')) return
                void (async () => {
                  try {
                    const result = await resetLibrary()
                    setSelected(null)
                    setNotes('')
                    await refresh()
                    setMessage(`Library reset (${result.removed_songs} songs removed).`)
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : String(err))
                  }
                })()
              }}
            >
              Reset library
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
          <h3>Songs ({songs.length})</h3>
          {songs.length === 0 ? (
            <p className="intent">No songs yet. Import audio, then “Add current file”.</p>
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
              Playlist: <strong>{favorites.name}</strong> ({favorites.songs.length} songs)
            </p>
          )}
        </div>

        <div style={{ flex: '2 1 420px', minWidth: 300 }}>
          {!selected ? (
            <p className="intent">Select a song to see notes, markers, clips and the player.</p>
          ) : (
            <section aria-label={`Song ${selected.title}`}>
              <h3>{selected.title}</h3>
              <p className="intent">
                {selected.path || 'no local path'} · updated{' '}
                {new Date(selected.updated * 1000).toLocaleString()}
              </p>

              <label className="field">
                <span>Notes ({notes.length}/{NOTES_LIMIT})</span>
                <textarea
                  rows={5}
                  maxLength={NOTES_LIMIT}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Practice notes, arrangement decisions, what to try next…"
                />
              </label>
              <div className="row">
                <button type="button" onClick={() => void saveNotes()} disabled={busy}>
                  Save notes
                </button>
                <button type="button" onClick={() => void remove()} disabled={busy}>
                  Remove from library
                </button>
                {favorites && (
                  <button
                    type="button"
                    onClick={() => void addToLibraryPlaylist(favorites.id, selected.id)}
                  >
                    Add to {favorites.name}
                  </button>
                )}
                <button type="button" onClick={() => void importPlayerData()} disabled={busy}>
                  Import player markers/clips
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const label = window.prompt('Version label', 'mix')
                    if (!label) return
                    void (async () => {
                      try {
                        await addLibraryVersion(selected.id, label)
                        const detail = await getLibrarySong(selected.id)
                        setSelected(detail.song)
                        setMessage(`Version “${label}” saved.`)
                      } catch (err) {
                        setMessage(err instanceof Error ? err.message : String(err))
                      }
                    })()
                  }}
                  disabled={busy}
                >
                  Save version
                </button>
              </div>

              {selected.path && (
                <PlayerSurface
                  src={libraryAudioUrl(selected.id)}
                  fileId={selected.id}
                  title={selected.title}
                  duration={selected.duration ?? undefined}
                />
              )}

              <div className="row" style={{ marginTop: '0.8rem', alignItems: 'flex-end' }}>
                <label className="field">
                  <span>Marker time (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={markerTime}
                    onChange={(event) => setMarkerTime(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Marker label</span>
                  <input
                    type="text"
                    value={markerLabel}
                    onChange={(event) => setMarkerLabel(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void addMarker()}>
                  Add marker
                </button>
              </div>
              <ul className="player-list">
                {(selected.markers || []).map((marker) => (
                  <li key={marker.id}>
                    <span>
                      {marker.time.toFixed(2)}s · {marker.label || 'marker'}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="row" style={{ marginTop: '0.6rem', alignItems: 'flex-end' }}>
                <label className="field">
                  <span>Clip start (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={clipStart}
                    onChange={(event) => setClipStart(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Clip end (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={clipEnd}
                    onChange={(event) => setClipEnd(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void addClip()}>
                  Add clip
                </button>
              </div>
              {(selected.versions || []).length > 0 && (
                <p className="intent">
                  Versions: {(selected.versions || []).map((version) => version.label).join(', ')}
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
    </div>
  )
}
