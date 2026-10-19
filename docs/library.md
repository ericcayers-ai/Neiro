# Library

The library is the durable, local home for songs, notes, markers, clips, scenes,
versions and playlists. It is a SQLite database, not a growing directory of JSON
sessions.

- Default path: `%LOCALAPPDATA%\Neiro\library.db` (or `~/.neiro/library.db`).
- Override for tests/portable use: `NEIRO_LIBRARY_DB`.
- Schema version lives in `PRAGMA user_version`; opening a newer database raises a
  clear error instead of corrupting it. The default **Favorites** playlist is
  created on first open.
- No account, cloud, share-link or slot-limit fields exist by design.

## Schema

| Table | Purpose |
|---|---|
| `songs` | title, artist, source URL, local path, duration, fingerprint, timestamps, scalar notes, settings JSON |
| `markers` | song, time, label, colour, kind |
| `clips` | song, name, start/end, loop count, enabled, settings JSON, order |
| `scenes` | song or global, name, kind (standard / timeline / clip-sequence), layout JSON |
| `playlists` + `playlist_items` | default Favorites plus user lists, ordered |
| `versions` | mutable version chain: label, session path, settings JSON |

Foreign keys are on; deleting a song cascades its markers/clips/scenes/versions and
playlist items. The audio file itself is never deleted.

## Notes

Notes are a **scalar string capped at 5,000 characters** (`user_notes` in session
documents; `notes` on songs). A list is rejected with 400, and legacy session files
that stored a character list are migrated to the scalar on load.

## HTTP API

All mutations require `X-Neiro-Token`. JSON only (`application/json`).

| Route | Methods |
|---|---|
| `/api/library/songs` | `GET` list, `POST` add (from `file_id` or metadata) |
| `/api/library/songs/<id>` | `GET` detail (with markers/clips/scenes/versions), `DELETE` |
| `/api/library/songs/<id>/notes` | `POST {notes}` |
| `/api/library/songs/<id>/markers` | `GET`, `POST {time,label,color}` |
| `/api/library/markers/<id>` | `DELETE` |
| `/api/library/songs/<id>/clips` | `GET`, `POST {name,start,end,loop_count}` |
| `/api/library/clips/<id>` | `DELETE` |
| `/api/library/scenes` | `GET`, `POST`; `/api/library/scenes/<id>` `DELETE` |
| `/api/library/playlists` | `GET`, `POST {name}`; `/api/library/playlists/<id>/items` `POST {song_id}` |
| `/api/library/songs/<id>/versions` | `POST {label,session_path}` |
| `/api/library/songs/<id>/settings` | `POST {settings}` per-song player settings |
| `/api/library/songs/<id>/played` | `POST` mark last-played (Resume last) |
| `/api/library/reset` | `POST {confirm:true}` remove all songs (audio files kept) |
| `/api/library/export` | `GET` local JSON backup |
| `/api/library/audio/<id>` | `GET` streams the stored local file (only the DB path) |

## UI

`frontend/src/modules/LibraryModule.tsx` (rail key `0`): add the current file, list
songs, resume the last-played song, edit notes with a live 5,000-character counter,
open the most recently played song from the shell's **Resume** card, add
markers/clips, import the player's local markers/clips for that song, save
labelled versions, add to Favorites, play through the shared `PlayerSurface`, and
save the player's per-song settings back to the library (debounced) so transpose /
speed / tuning survive a restart. Remove/export/reset are also there. Player-level data reset lives in
Prefs → Data and reset.

## Limits and honest gaps

- Markers/clips created in the player are stored per file in `localStorage`; the
  library API is the durable store, and the UI shows what the library holds.
  Promoting player-created markers into the library is a follow-up (not yet
  automatic).
- There is no cloud sync and no share link; `GET /api/library/export` is the backup
  path.
- The byte-bounded artifact cache and disk preflight cover engine artifacts; a
  per-library size quota is not enforced beyond the OS filesystem.
