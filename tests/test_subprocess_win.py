"""Focused tests for Windows-silent subprocess kwargs."""

from __future__ import annotations

import sys
from unittest import mock

from neiro.util import subprocess_win


def test_silent_kwargs_passthrough_non_windows():
    with mock.patch.object(sys, "platform", "linux"):
        out = subprocess_win.silent_kwargs(timeout=5, check=True)
    assert out == {"timeout": 5, "check": True}


def test_silent_kwargs_adds_create_no_window_on_win32():
    with mock.patch.object(sys, "platform", "win32"):
        out = subprocess_win.silent_kwargs(timeout=12, check=False)
    assert out["timeout"] == 12
    assert out["check"] is False
    assert out["creationflags"] & subprocess_win.CREATE_NO_WINDOW
    assert "startupinfo" in out
    assert out["startupinfo"].dwFlags & subprocess_win.STARTF_USESHOWWINDOW
    assert out["startupinfo"].wShowWindow == subprocess_win.SW_HIDE


def test_silent_kwargs_merges_existing_creationflags():
    with mock.patch.object(sys, "platform", "win32"):
        out = subprocess_win.silent_kwargs(creationflags=0x1)
    assert out["creationflags"] & 0x1
    assert out["creationflags"] & subprocess_win.CREATE_NO_WINDOW
