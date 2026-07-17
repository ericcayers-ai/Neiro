"""Silent subprocess helpers for Windows (no flashing console windows).

Adapters that shell out to ffmpeg, MuseScore, Transkun, etc. should use
:func:`run` / :func:`popen` so ``CREATE_NO_WINDOW`` + hidden STARTUPINFO apply
on win32. Other platforms are unchanged.
"""

from __future__ import annotations

import subprocess
import sys
from typing import Any

__all__ = [
    "CREATE_NO_WINDOW",
    "STARTF_USESHOWWINDOW",
    "SW_HIDE",
    "silent_kwargs",
    "run",
    "Popen",
]

# Win32 process creation / startup flags (no-ops on other platforms).
CREATE_NO_WINDOW = 0x08000000
STARTF_USESHOWWINDOW = 0x00000001
SW_HIDE = 0


def silent_kwargs(**extra: Any) -> dict[str, Any]:
    """Merge caller kwargs with Windows hide-window flags when needed."""
    kwargs = dict(extra)
    if sys.platform != "win32":
        return kwargs
    flags = int(kwargs.pop("creationflags", 0) or 0) | CREATE_NO_WINDOW
    kwargs["creationflags"] = flags
    if "startupinfo" not in kwargs:
        si = subprocess.STARTUPINFO()
        si.dwFlags |= STARTF_USESHOWWINDOW
        si.wShowWindow = SW_HIDE
        kwargs["startupinfo"] = si
    return kwargs


def run(cmd: Any, **kwargs: Any) -> subprocess.CompletedProcess[Any]:
    """``subprocess.run`` with Windows console windows suppressed."""
    return subprocess.run(cmd, **silent_kwargs(**kwargs))


def Popen(cmd: Any, **kwargs: Any) -> subprocess.Popen[Any]:
    """``subprocess.Popen`` with Windows console windows suppressed."""
    return subprocess.Popen(cmd, **silent_kwargs(**kwargs))
