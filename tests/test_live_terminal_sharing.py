"""
test_live_terminal_sharing.py
Unit and integration tests for Live Terminal Sharing module in Python companion app.
"""

import time
import pytest
from companion.live_terminal_sharing import (
    E2EEncryptor,
    PermissionManager,
    CursorTracker,
    SessionRecorder,
    SessionPlayer,
    WebRTCManager,
    TerminalSession
)


def test_encryption_key_generation_and_derivation():
    encryptor = E2EEncryptor()
    assert not encryptor.has_key()

    key = encryptor.generate_key()
    assert len(key) == 64
    encryptor.set_key(key)
    assert encryptor.has_key()

    derived = encryptor.derive_key_from_passphrase("passphrase123", "salt456")
    assert len(derived) == 64


def test_encrypt_and_decrypt_payloads():
    encryptor = E2EEncryptor()
    encryptor.set_key(encryptor.generate_key())

    message = "echo 'Testing Python Live Terminal Sharing'"
    encrypted = encryptor.encrypt(message)
    assert encrypted["encrypted"] is True
    assert "ciphertext" in encrypted
    assert "iv" in encrypted
    assert "authTag" in encrypted

    decrypted = encryptor.decrypt(encrypted)
    assert decrypted == message

    json_payload = {"cmd": "make test", "code": 0, "active": True}
    encrypted_json = encryptor.encrypt(json_payload)
    decrypted_json = encryptor.decrypt(encrypted_json)
    assert decrypted_json == json_payload


def test_encryption_tamper_detection():
    encryptor = E2EEncryptor()
    encryptor.set_key(encryptor.generate_key())

    encrypted = encryptor.encrypt("secret message")
    encrypted["authTag"] = "0000000000000000000000000000000000000000000000000000000000000000"

    with pytest.raises(ValueError):
        encryptor.decrypt(encrypted)


def test_permission_manager_roles_and_actions():
    pm = PermissionManager("host_1", PermissionManager.ROLE_READ_ONLY)
    assert pm.get_role("host_1") == PermissionManager.ROLE_ADMIN
    assert pm.get_role("peer_1") == PermissionManager.ROLE_READ_ONLY

    assert pm.has_permission("host_1", PermissionManager.ACTION_WRITE) is True
    assert pm.has_permission("host_1", PermissionManager.ACTION_TERMINATE_SESSION) is True

    assert pm.has_permission("peer_1", PermissionManager.ACTION_READ) is True
    assert pm.has_permission("peer_1", PermissionManager.ACTION_WRITE) is False
    assert pm.has_permission("peer_1", PermissionManager.ACTION_REQUEST_CONTROL) is True

    pm.set_role("peer_1", PermissionManager.ROLE_READ_WRITE)
    assert pm.has_permission("peer_1", PermissionManager.ACTION_WRITE) is True
    assert pm.has_permission("peer_1", PermissionManager.ACTION_RESIZE) is True
    assert pm.has_permission("peer_1", PermissionManager.ACTION_TERMINATE_SESSION) is False


def test_permission_control_requests():
    pm = PermissionManager("host_1")
    req = pm.request_control("peer_1", PermissionManager.ROLE_READ_WRITE, "Need write access")
    assert req["status"] == "pending"
    assert len(pm.get_pending_requests()) == 1

    # Non-admin cannot approve
    with pytest.raises(ValueError):
        pm.approve_control_request(req["requestId"], "peer_1")

    # Admin approves
    approved = pm.approve_control_request(req["requestId"], "host_1")
    assert approved["status"] == "approved"
    assert pm.get_role("peer_1") == PermissionManager.ROLE_READ_WRITE
    assert len(pm.get_pending_requests()) == 0


def test_cursor_tracker():
    tracker = CursorTracker()
    cursor = tracker.set_cursor("p1", {"row": 3, "col": 10, "username": "Alice"})
    assert cursor["participantId"] == "p1"
    assert cursor["row"] == 3
    assert cursor["col"] == 10
    assert cursor["color"].startswith("#")

    all_cursors = tracker.get_all_cursors()
    assert len(all_cursors) == 1

    tracker.remove_cursor("p1")
    assert tracker.get_cursor("p1") is None


def test_session_recorder_and_player():
    recorder = SessionRecorder("session_py_rec")
    recorder.start_recording()
    assert recorder.is_recording() is True

    recorder.record_event("output", "python terminal ready\n", "host_1")
    recorder.record_event("input", "pip test\n", "peer_1")
    meta = recorder.stop_recording()

    assert meta["frameCount"] == 2

    json_str = recorder.export_json()
    assert "session_py_rec" in json_str
    assert "python terminal ready" in json_str

    asciinema_str = recorder.export_asciinema()
    assert '"version": 2' in asciinema_str
    assert '"o"' in asciinema_str

    player = SessionPlayer(json_str)
    assert player.get_metadata()["totalFrames"] == 2

    played = player.play_all()
    assert len(played) == 2


def test_webrtc_signaling_and_data_channel():
    signaling_msgs = []
    rtc = WebRTCManager("peer_py", lambda msg: signaling_msgs.append(msg))
    assert rtc.get_status() == WebRTCManager.STATE_NEW

    offer = rtc.create_offer()
    assert offer["type"] == "offer"
    assert len(signaling_msgs) == 1

    answer = rtc.handle_offer(offer)
    assert answer["type"] == "answer"
    assert rtc.get_status() == WebRTCManager.STATE_CONNECTED

    encryptor = E2EEncryptor()
    encryptor.set_key(encryptor.generate_key())
    rtc.set_encryptor(encryptor)

    received_data = []
    rtc.on_message(lambda data: received_data.append(data))

    payload = {"type": "cmd", "val": "clear"}
    sent_encrypted = rtc.send_message(payload)
    assert sent_encrypted["encrypted"] is True

    decrypted = rtc.receive_message(sent_encrypted)
    assert decrypted == payload
    assert len(received_data) == 1


def test_terminal_session_orchestration():
    session = TerminalSession("sess_py_01", "host_py", "Dev Session")
    key = session.encryptor.generate_key()
    session.set_encryption_key(key)

    p1 = session.join({"id": "peer_user", "username": "User1"})
    assert p1["role"] == PermissionManager.ROLE_READ_ONLY

    # Read-only cannot input
    with pytest.raises(ValueError):
        session.process_input("peer_user", "rm file.txt")

    # Grant write permission
    session.permission_manager.set_role("peer_user", PermissionManager.ROLE_READ_WRITE)
    input_res = session.process_input("peer_user", "ls\n")
    assert input_res["data"] == "ls\n"

    # Broadcast output
    out_res = session.broadcast_output("file1 file2\n")
    assert out_res["data"] == "file1 file2\n"
    assert len(session.get_scrollback_history()) == 1

    # Cursor & Resize
    cursor = session.update_cursor("peer_user", 5, 20)
    assert cursor["row"] == 5

    dim = session.resize_terminal("peer_user", 30, 100)
    assert dim["rows"] == 30

    state = session.get_session_state()
    assert state["sessionId"] == "sess_py_01"
    assert len(state["participants"]) == 2
    assert state["encrypted"] is True


def test_live_terminal_sharing_performance_benchmark():
    encryptor = E2EEncryptor()
    encryptor.set_key(encryptor.generate_key())

    start_time = time.time()
    iterations = 500

    for i in range(iterations):
        enc = encryptor.encrypt(f"data_chunk_{i}")
        encryptor.decrypt(enc)

    elapsed = time.time() - start_time
    assert elapsed < 1.0  # 500 ops in less than 1 sec
