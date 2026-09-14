import time
import json
import pytest
from companion.terminal_sharing import (
    E2EEncryptionManager,
    CursorTracker,
    PermissionManager,
    SessionRecorder,
    TerminalSharingSession,
    Role,
    SessionState,
    EventType,
)


def test_e2e_encryption_manager_key_and_crypto():
    enc = E2EEncryptionManager()
    assert len(enc.key) == 64

    enc_custom = E2EEncryptionManager("my-secret-passphrase")
    assert len(enc_custom.key) == 64

    sample_str = "echo 'Collaborative Shell'"
    encrypted = enc_custom.encrypt(sample_str)
    assert "ciphertext" in encrypted
    assert "tag" in encrypted

    decrypted = enc_custom.decrypt(encrypted)
    assert decrypted == sample_str

    # Test tampering handling
    encrypted_tampered = dict(encrypted)
    encrypted_tampered["tag"] = "f" * 64
    with pytest.raises(ValueError, match="E2E Decryption failed"):
        enc_custom.decrypt(encrypted_tampered)


def test_cursor_tracker():
    tracker = CursorTracker()
    c1 = tracker.update_cursor("p1", line=10, col=15, name="Alice", color="#0000ff")
    assert c1["participantId"] == "p1"
    assert c1["line"] == 10
    assert c1["col"] == 15

    all_cursors = tracker.get_all_cursors()
    assert len(all_cursors) == 1

    tracker.remove_cursor("p1")
    assert tracker.get_cursor("p1") is None


def test_permission_manager():
    perm = PermissionManager(default_role=Role.VIEWER)
    perm.set_role("host1", Role.HOST)
    perm.set_role("user1", Role.VIEWER)

    assert perm.can_write("host1") is True
    assert perm.can_write("user1") is False

    req = perm.request_control("user1", "Need write access")
    assert req["status"] == "pending"
    assert len(perm.get_pending_requests()) == 1

    granted = perm.grant_control("user1")
    assert granted is True
    assert perm.can_write("user1") is True
    assert perm.get_role("user1") == Role.EDITOR

    revoked = perm.revoke_control("user1")
    assert revoked is True
    assert perm.can_write("user1") is False

    with pytest.raises(PermissionError, match="Cannot revoke write permission from Host"):
        perm.revoke_control("host1")


def test_session_recorder():
    rec = SessionRecorder()
    rec.start()
    rec.record_frame(EventType.OUTPUT, "host$ ", "host")
    rec.record_frame(EventType.INPUT, "ls -l\n", "user1")

    assert len(rec.get_frames()) == 2

    rec.pause()
    rec.record_frame(EventType.OUTPUT, "ignored while paused", "host")
    assert len(rec.get_frames()) == 2

    rec.resume()
    rec.record_frame(EventType.OUTPUT, "active again\n", "host")
    assert len(rec.get_frames()) == 3

    rec.stop()

    asciinema_out = rec.export_asciinema(title="Python Asciinema")
    assert "version" in asciinema_out
    assert "Python Asciinema" in asciinema_out

    json_out = rec.export_json()
    assert "totalFrames" in json_out


def test_terminal_sharing_session_full_lifecycle():
    session = TerminalSharingSession(
        session_id="py-sess-1",
        title="Python Live Terminal",
        host={"id": "host_py", "name": "Python Host"},
        max_participants=3,
        e2e_enabled=True,
    )

    session.start()
    assert session.state == SessionState.ACTIVE

    p2 = session.join_participant({"id": "peer2", "name": "Peer Two", "role": "viewer"})
    assert p2["role"] == Role.VIEWER.value
    assert len(session.participants) == 2

    out_frame = session.broadcast_output("Starting python build...\n")
    assert out_frame["type"] == EventType.OUTPUT.value
    assert out_frame["isEncrypted"] is True

    # Peer2 cannot send input without permission
    with pytest.raises(PermissionError):
        session.send_input("peer2", "python test.py\n")

    # Grant permission to Peer2
    session.request_input_permission("peer2", "Running test script")
    session.grant_input_permission("host_py", "peer2")

    in_frame = session.send_input("peer2", "pytest tests/\n")
    assert in_frame["senderId"] == "peer2"

    # Recording workflow
    session.start_recording()
    session.broadcast_output("Recording active frame...\n")
    session.stop_recording()

    rec_asciinema = session.export_recording(format_type="asciinema")
    assert "Recording active frame" in rec_asciinema

    metrics = session.get_metrics()
    assert metrics["framesProcessed"] >= 2
    assert metrics["activeParticipants"] == 2

    session.end_session()
    assert session.state == SessionState.ENDED
    assert len(session.participants) == 0
