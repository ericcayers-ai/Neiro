"""Tests for the shared-window DAW injector bridge."""

from __future__ import annotations

from neiro.ui.daw_bridge import DawBridgeState


def test_register_show_ui_and_midi_roundtrip():
    bridge = DawBridgeState()
    inst = bridge.register(track_name="Lead", host="test-host", sample_rate=48000)
    assert inst.instance_id.startswith("daw-")
    assert bridge.status()["connected"] is True
    assert bridge.status()["instance_count"] == 1

    status = bridge.request_show_ui(inst.instance_id, module="learn")
    assert status["focus_instance"] == inst.instance_id
    # Legacy learn/transcribe normalize to midi (MIDI Studio).
    assert status["focus_module"] == "midi"
    assert status["focus_seq"] == 1
    assert status["shared_window"] is True

    pushed = bridge.push_midi(inst.instance_id, pitch=60, velocity=100, note_on=True)
    assert pushed["ok"] is True
    assert pushed["midi_seq"] == 1

    batch = bridge.poll_midi(after_seq=0)
    assert batch["midi_seq"] == 1
    assert len(batch["events"]) == 1
    assert batch["events"][0]["pitch"] == 60

    empty = bridge.poll_midi(after_seq=1)
    assert empty["events"] == []

    assert bridge.heartbeat(inst.instance_id, peak=0.5, frames=128) is True
    assert bridge.unregister(inst.instance_id) is True
    assert bridge.status()["connected"] is False


def test_browser_open_only_once():
    bridge = DawBridgeState()
    bridge.register(track_name="A")
    bridge.request_show_ui(module="learn")
    assert bridge.consume_launch_request() is True
    bridge.request_show_ui(module="learn")
    assert bridge.consume_launch_request() is False


def test_stale_unknown_midi_raises():
    bridge = DawBridgeState()
    try:
        bridge.push_midi("missing", pitch=1)
        raise AssertionError("expected KeyError")
    except KeyError:
        pass


def test_publish_capture_allows_any_module_and_bumps_seq():
    bridge = DawBridgeState()
    inst = bridge.register(track_name="Cap")
    before = bridge.status()["capture_seq"]
    payload = {
        "file_id": "deadbeefcafe",
        "name": "take.wav",
        "audio_url": "/files/uploads/deadbeefcafe/take.wav",
        "report": {"duration_seconds": 1.23, "sample_rate": 44100, "channels": 2},
    }
    status = bridge.publish_capture(inst.instance_id, file_payload=payload, module="transcribe")
    assert status["capture_seq"] == before + 1
    assert status["last_capture"]["file_id"] == "deadbeefcafe"
    assert status["focus_module"] == "midi"
    assert "midi" in status["allowed_modules"]
    assert "transcribe" in status["allowed_modules"]  # legacy alias still listed
