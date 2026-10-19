"""HTTP surface for the local library. Called from the main handler."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from neiro.library.store import LibraryStore


def _store() -> LibraryStore:
    return LibraryStore()


def _duration_of(path: Path) -> float | None:
    try:
        import soundfile as sf

        return float(sf.info(str(path)).duration)
    except Exception:
        return None


def handle_library(
    state: Any, method: str, path: str, body: dict | None = None
) -> tuple[int, dict]:
    """Dispatch ``/api/library/...`` and return ``(status, payload)``."""
    store = _store()
    parts = [part for part in path.strip("/").split("/") if part]
    # api / library / <resource> / ...
    resource = parts[2] if len(parts) > 2 else ""
    rest = parts[3:]
    body = body or {}

    try:
        if resource == "songs" and not rest:
            if method == "GET":
                return 200, {"songs": store.list_songs()}
            if method == "POST":
                file_id = str(body.get("file_id") or "")
                path_value = None
                if file_id:
                    if file_id not in state.files:
                        return 400, {"error": f"unknown file_id {file_id!r}"}
                    path_value = str(state.files[file_id])
                title = str(
                    body.get("title") or (Path(path_value).name if path_value else "Untitled")
                )
                song = store.upsert_song(
                    title=title,
                    artist=body.get("artist"),
                    source_url=body.get("source_url"),
                    path=path_value,
                    duration=body.get("duration")
                    or (_duration_of(Path(path_value)) if path_value else None),
                    fingerprint=body.get("fingerprint"),
                    notes=body.get("notes"),
                    settings=body.get("settings"),
                )
                return 200, {"ok": True, "song": song}

        if resource == "songs" and rest:
            song_id = rest[0]
            if len(rest) == 1:
                if method == "GET":
                    song = store.get_song(song_id)
                    if song is None:
                        return 404, {"error": "song not found"}
                    return 200, {"song": song}
                if method == "DELETE":
                    return 200, {"ok": store.delete_song(song_id)}
            if len(rest) == 2 and rest[1] == "notes" and method == "POST":
                return 200, store.set_notes(song_id, str(body.get("notes") or ""))
            if len(rest) == 2 and rest[1] == "markers":
                if method == "GET":
                    song = store.get_song(song_id)
                    if song is None:
                        return 404, {"error": "song not found"}
                    return 200, {"markers": song["markers"]}
                if method == "POST":
                    marker = store.add_marker(
                        song_id,
                        float(body.get("time") or 0.0),
                        str(body.get("label") or ""),
                        body.get("color"),
                    )
                    return 200, {"ok": True, "marker": marker}
            if len(rest) == 2 and rest[1] == "clips":
                if method == "GET":
                    song = store.get_song(song_id)
                    if song is None:
                        return 404, {"error": "song not found"}
                    return 200, {"clips": song["clips"]}
                if method == "POST":
                    clip = store.add_clip(
                        song_id,
                        name=str(body.get("name") or "Clip"),
                        start=float(body.get("start") or 0.0),
                        end=float(body.get("end") or 0.0),
                        loop_count=int(body.get("loop_count") or 1),
                        enabled=bool(body.get("enabled", True)),
                        settings=body.get("settings"),
                    )
                    return 200, {"ok": True, "clip": clip}
            if len(rest) == 2 and rest[1] == "settings" and method == "POST":
                settings = body.get("settings")
                if not isinstance(settings, dict):
                    return 400, {"error": "settings must be an object"}
                return 200, store.set_settings(song_id, settings)
            if len(rest) == 2 and rest[1] == "played" and method == "POST":
                store.touch_song(song_id)
                return 200, {"ok": True, "song_id": song_id}
            if len(rest) == 2 and rest[1] == "versions" and method == "POST":
                version = store.add_version(
                    song_id,
                    label=str(body.get("label") or "version"),
                    session_path=body.get("session_path"),
                    settings=body.get("settings"),
                )
                return 200, {"ok": True, "version": version}

        if resource == "markers" and rest and method == "DELETE":
            return 200, {"ok": store.delete_marker(rest[0])}
        if resource == "clips" and rest and method == "DELETE":
            return 200, {"ok": store.delete_clip(rest[0])}
        if resource == "scenes":
            if method == "GET" and not rest:
                with store._connect() as conn:  # read-only helper: all scenes
                    rows = conn.execute("SELECT * FROM scenes ORDER BY created").fetchall()
                return 200, {"scenes": [store._scene_row(row) for row in rows]}
            if method == "POST" and not rest:
                scene = store.add_scene(
                    name=str(body.get("name") or "Scene"),
                    kind=str(body.get("kind") or "standard"),
                    song_id=body.get("song_id"),
                    layout=body.get("layout"),
                )
                return 200, {"ok": True, "scene": scene}
            if method == "DELETE" and rest:
                return 200, {"ok": store.delete_scene(rest[0])}
        if resource == "playlists":
            if method == "GET" and not rest:
                return 200, {"playlists": store.list_playlists()}
            if method == "POST" and not rest:
                return 200, {
                    "ok": True,
                    "playlist": store.create_playlist(str(body.get("name") or "Playlist")),
                }
            if method == "POST" and len(rest) == 2 and rest[1] == "items":
                return 200, store.add_to_playlist(rest[0], str(body.get("song_id") or ""))
        if resource == "reset" and method == "POST":
            if body.get("confirm") is not True:
                return 400, {"error": "library reset requires {'confirm': true}"}
            with store._connect() as conn:
                songs = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
                conn.execute("DELETE FROM songs")
                conn.execute("DELETE FROM playlist_items")
                conn.execute("DELETE FROM scenes")
            return 200, {"ok": True, "removed_songs": songs}
        if resource == "export" and method == "GET":
            return 200, {
                "version": 1,
                "exported_at": __import__("time").time(),
                "songs": store.list_songs(),
                "playlists": store.list_playlists(),
            }
    except KeyError as exc:
        return 404, {"error": str(exc).strip("'\"")}
    except ValueError as exc:
        return 400, {"error": str(exc)}

    return 404, {"error": "unknown library route"}
