"""SQLite library for songs, notes, markers, clips, scenes, versions, playlists.

Design rules:
* one local database (`%LOCALAPPDATA%\\Neiro\\library.db`, override with
  ``NEIRO_LIBRARY_DB``), schema-versioned and migrated on open;
* free-text notes are a scalar capped at 5,000 characters (never a character list);
* every write returns the public dict the API hands back;
* no network, no accounts — export/backup is the sharing path.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

NOTES_LIMIT = 5000
SCHEMA_VERSION = 1


def default_db_path() -> Path:
    override = os.environ.get("NEIRO_LIBRARY_DB")
    if override:
        return Path(override)
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / "Neiro" / "library.db"
    return Path.home() / ".neiro" / "library.db"


def _now() -> float:
    return time.time()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


_SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  source_url TEXT,
  path TEXT,
  duration REAL,
  fingerprint TEXT,
  created REAL NOT NULL,
  updated REAL NOT NULL,
  last_played REAL,
  notes TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS songs_path ON songs(path) WHERE path IS NOT NULL;

CREATE TABLE IF NOT EXISTS markers (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  time REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  color TEXT,
  kind TEXT NOT NULL DEFAULT 'marker',
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS markers_song ON markers(song_id, time);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL,
  loop_count INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS clips_song ON clips(song_id, position);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'standard',
  layout_json TEXT NOT NULL DEFAULT '{}',
  created REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS playlist_item_unique ON playlist_items(playlist_id, song_id);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  session_path TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created REAL NOT NULL
);
"""


class LibraryStore:
    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise ValueError(
                    f"library schema {version} is newer than this Neiro ({SCHEMA_VERSION})"
                )
            conn.executescript(_SCHEMA)
            if (
                conn.execute("SELECT COUNT(*) FROM playlists WHERE is_default = 1").fetchone()[0]
                == 0
            ):
                conn.execute(
                    "INSERT INTO playlists (id, name, is_default, created) VALUES (?, ?, 1, ?)",
                    (_new_id("pl"), "Favorites", _now()),
                )
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    # -- songs -------------------------------------------------------------
    def upsert_song(
        self,
        *,
        title: str,
        artist: str | None = None,
        source_url: str | None = None,
        path: str | None = None,
        duration: float | None = None,
        fingerprint: str | None = None,
        notes: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if notes is not None and len(notes) > NOTES_LIMIT:
            raise ValueError(f"notes exceed the {NOTES_LIMIT}-character limit")
        now = _now()
        with self._connect() as conn:
            existing = None
            if path:
                existing = conn.execute("SELECT id FROM songs WHERE path = ?", (path,)).fetchone()
            if existing:
                song_id = existing["id"]
                conn.execute(
                    """UPDATE songs SET title=?, artist=COALESCE(?, artist),
                       source_url=COALESCE(?, source_url), duration=COALESCE(?, duration),
                       fingerprint=COALESCE(?, fingerprint), updated=?,
                       notes=COALESCE(?, notes), settings_json=COALESCE(?, settings_json)
                       WHERE id=?""",
                    (
                        title,
                        artist,
                        source_url,
                        duration,
                        fingerprint,
                        now,
                        notes,
                        json.dumps(settings) if settings is not None else None,
                        song_id,
                    ),
                )
            else:
                song_id = _new_id("song")
                conn.execute(
                    """INSERT INTO songs
                       (id, title, artist, source_url, path, duration, fingerprint,
                        created, updated, last_played, notes, settings_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)""",
                    (
                        song_id,
                        title,
                        artist,
                        source_url,
                        path,
                        duration,
                        fingerprint,
                        now,
                        now,
                        notes or "",
                        json.dumps(settings or {}),
                    ),
                )
        return self.get_song(song_id) or {}

    def list_songs(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM songs ORDER BY updated DESC").fetchall()
        return [self._song_row(row) for row in rows]

    def get_song(self, song_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
            if row is None:
                return None
            song = self._song_row(row)
            song["markers"] = [
                dict(m)
                for m in conn.execute(
                    "SELECT * FROM markers WHERE song_id = ? ORDER BY time", (song_id,)
                ).fetchall()
            ]
            song["clips"] = [
                self._clip_row(c)
                for c in conn.execute(
                    "SELECT * FROM clips WHERE song_id = ? ORDER BY position, start", (song_id,)
                ).fetchall()
            ]
            song["scenes"] = [
                self._scene_row(s)
                for s in conn.execute(
                    "SELECT * FROM scenes WHERE song_id = ? ORDER BY created", (song_id,)
                ).fetchall()
            ]
            song["versions"] = [
                self._version_row(v)
                for v in conn.execute(
                    "SELECT * FROM versions WHERE song_id = ? ORDER BY created DESC", (song_id,)
                ).fetchall()
            ]
        return song

    def delete_song(self, song_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
            return cursor.rowcount > 0

    def set_notes(self, song_id: str, notes: str) -> dict[str, Any]:
        if not isinstance(notes, str):
            raise ValueError("notes must be a string")
        if len(notes) > NOTES_LIMIT:
            raise ValueError(f"notes exceed the {NOTES_LIMIT}-character limit")
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE songs SET notes = ?, updated = ? WHERE id = ?", (notes, _now(), song_id)
            )
            if cursor.rowcount == 0:
                raise KeyError(f"unknown song {song_id!r}")
        return {"id": song_id, "notes": notes, "limit": NOTES_LIMIT}

    def touch_song(self, song_id: str) -> None:
        with self._connect() as conn:
            conn.execute("UPDATE songs SET last_played = ? WHERE id = ?", (_now(), song_id))

    # -- markers -----------------------------------------------------------
    def add_marker(
        self, song_id: str, time_s: float, label: str = "", color: str | None = None
    ) -> dict[str, Any]:
        marker_id = _new_id("marker")
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO markers (id, song_id, time, label, color, kind, created)
                   VALUES (?, ?, ?, ?, ?, 'marker', ?)""",
                (marker_id, song_id, max(0.0, float(time_s)), label, color, _now()),
            )
        return {
            "id": marker_id,
            "song_id": song_id,
            "time": max(0.0, float(time_s)),
            "label": label,
            "color": color,
        }

    def delete_marker(self, marker_id: str) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM markers WHERE id = ?", (marker_id,)).rowcount > 0

    # -- clips -------------------------------------------------------------
    def add_clip(
        self,
        song_id: str,
        *,
        name: str,
        start: float,
        end: float,
        loop_count: int = 1,
        enabled: bool = True,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        clip_id = _new_id("clip")
        start = max(0.0, float(start))
        end = max(start + 0.05, float(end))
        with self._connect() as conn:
            position = conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM clips WHERE song_id = ?", (song_id,)
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO clips
                   (id, song_id, name, start, end, loop_count, enabled, settings_json, position, created)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    clip_id,
                    song_id,
                    name,
                    start,
                    end,
                    max(1, int(loop_count)),
                    1 if enabled else 0,
                    json.dumps(settings or {}),
                    position,
                    _now(),
                ),
            )
        return {
            "id": clip_id,
            "song_id": song_id,
            "name": name,
            "start": start,
            "end": end,
            "loop_count": max(1, int(loop_count)),
            "enabled": enabled,
            "settings": settings or {},
            "position": position,
        }

    def delete_clip(self, clip_id: str) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM clips WHERE id = ?", (clip_id,)).rowcount > 0

    # -- scenes ------------------------------------------------------------
    def add_scene(
        self,
        *,
        name: str,
        kind: str = "standard",
        song_id: str | None = None,
        layout: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        scene_id = _new_id("scene")
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO scenes (id, song_id, name, kind, layout_json, created)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (scene_id, song_id, name, kind, json.dumps(layout or {}), _now()),
            )
        return {
            "id": scene_id,
            "song_id": song_id,
            "name": name,
            "kind": kind,
            "layout": layout or {},
        }

    def delete_scene(self, scene_id: str) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM scenes WHERE id = ?", (scene_id,)).rowcount > 0

    # -- playlists ---------------------------------------------------------
    def list_playlists(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            playlists = conn.execute(
                "SELECT * FROM playlists ORDER BY is_default DESC, name"
            ).fetchall()
            result = []
            for playlist in playlists:
                items = conn.execute(
                    """SELECT s.id, s.title FROM playlist_items i
                       JOIN songs s ON s.id = i.song_id
                       WHERE i.playlist_id = ? ORDER BY i.position""",
                    (playlist["id"],),
                ).fetchall()
                result.append(
                    {
                        "id": playlist["id"],
                        "name": playlist["name"],
                        "is_default": bool(playlist["is_default"]),
                        "songs": [dict(item) for item in items],
                    }
                )
        return result

    def create_playlist(self, name: str) -> dict[str, Any]:
        playlist_id = _new_id("pl")
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO playlists (id, name, is_default, created) VALUES (?, ?, 0, ?)",
                (playlist_id, name, _now()),
            )
        return {"id": playlist_id, "name": name, "is_default": False, "songs": []}

    def add_to_playlist(self, playlist_id: str, song_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            position = conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_items WHERE playlist_id = ?",
                (playlist_id,),
            ).fetchone()[0]
            conn.execute(
                """INSERT OR IGNORE INTO playlist_items
                   (id, playlist_id, song_id, position, created) VALUES (?, ?, ?, ?, ?)""",
                (_new_id("pli"), playlist_id, song_id, position, _now()),
            )
        return {"ok": True, "playlist_id": playlist_id, "song_id": song_id}

    # -- versions ----------------------------------------------------------
    def add_version(
        self,
        song_id: str,
        *,
        label: str,
        session_path: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        version_id = _new_id("ver")
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO versions (id, song_id, label, session_path, settings_json, created)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (version_id, song_id, label, session_path, json.dumps(settings or {}), _now()),
            )
        return {
            "id": version_id,
            "song_id": song_id,
            "label": label,
            "session_path": session_path,
            "settings": settings or {},
        }

    # -- row mapping -------------------------------------------------------
    @staticmethod
    def _song_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "title": row["title"],
            "artist": row["artist"],
            "source_url": row["source_url"],
            "path": row["path"],
            "duration": row["duration"],
            "fingerprint": row["fingerprint"],
            "created": row["created"],
            "updated": row["updated"],
            "last_played": row["last_played"],
            "notes": row["notes"],
            "settings": json.loads(row["settings_json"] or "{}"),
        }

    @staticmethod
    def _clip_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "song_id": row["song_id"],
            "name": row["name"],
            "start": row["start"],
            "end": row["end"],
            "loop_count": row["loop_count"],
            "enabled": bool(row["enabled"]),
            "settings": json.loads(row["settings_json"] or "{}"),
            "position": row["position"],
        }

    @staticmethod
    def _scene_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "song_id": row["song_id"],
            "name": row["name"],
            "kind": row["kind"],
            "layout": json.loads(row["layout_json"] or "{}"),
        }

    @staticmethod
    def _version_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "song_id": row["song_id"],
            "label": row["label"],
            "session_path": row["session_path"],
            "settings": json.loads(row["settings_json"] or "{}"),
            "created": row["created"],
        }
