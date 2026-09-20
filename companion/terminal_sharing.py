#!/usr/bin/env python3
"""
Companion Live Terminal Sharing Module.
Provides Python backend collaborative terminal sessions, cursor tracking,
permission management, session recording, and E2E encryption.
"""

import os
import time
import json
import base64
import hashlib
import hmac
import secrets
from enum import Enum
from typing import Dict, List, Optional, Any, Union


class Role(str, Enum):
    HOST = "host"
    EDITOR = "editor"
    VIEWER = "viewer"


class SessionState(str, Enum):
    IDLE = "idle"
    ACTIVE = "active"
    PAUSED = "paused"
    ENDED = "ended"


class EventType(str, Enum):
    OUTPUT = "output"
    INPUT = "input"
    CURSOR = "cursor"
    RESIZE = "resize"
    PERMISSION = "permission"
    PEER_JOIN = "peer_join"
    PEER_LEAVE = "peer_leave"


class E2EEncryptionManager:
    """
    E2E Encryption manager supporting key generation, key derivation, and encryption/decryption.
    """

    def __init__(self, secret_key: Optional[str] = None):
        if secret_key:
            self.set_key(secret_key)
        else:
            self.key = self.generate_key()

    @staticmethod
    def generate_key() -> str:
        return secrets.token_hex(32)

    def set_key(self, key_or_passphrase: str) -> None:
        if not key_or_passphrase:
            return
        if len(key_or_passphrase) == 64 and all(c in "0123456789abcdefABCDEF" for c in key_or_passphrase):
            self.key = key_or_passphrase.lower()
        else:
            self.key = hashlib.sha256(key_or_passphrase.encode("utf-8")).hexdigest()

    def encrypt(self, data: Union[str, Dict, List]) -> Dict[str, Any]:
        json_str = data if isinstance(data, str) else json.dumps(data)
        iv = secrets.token_hex(8)
        
        # XOR with key stream + HMAC tag
        key_bytes = bytes.fromhex(self.key)
        plain_bytes = json_str.encode("utf-8")
        
        ciphertext_bytes = bytearray()
        for i, b in enumerate(plain_bytes):
            ciphertext_bytes.append(b ^ key_bytes[i % len(key_bytes)])
            
        tag = hmac.new(key_bytes, ciphertext_bytes, hashlib.sha256).hexdigest()
        
        return {
            "algorithm": "XOR-HMAC-SHA256",
            "ciphertext": base64.b64encode(ciphertext_bytes).decode("utf-8"),
            "iv": base64.b64encode(iv.encode("utf-8")).decode("utf-8"),
            "tag": tag,
        }

    def decrypt(self, payload: Union[Dict[str, Any], str]) -> Any:
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return payload

        if not isinstance(payload, dict) or "ciphertext" not in payload:
            return payload

        key_bytes = bytes.fromhex(self.key)
        ciphertext_bytes = base64.b64decode(payload["ciphertext"])
        
        if "tag" in payload:
            expected_tag = hmac.new(key_bytes, ciphertext_bytes, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected_tag, payload["tag"]):
                raise ValueError("E2E Decryption failed: Invalid HMAC tag or tampered ciphertext")

        plain_bytes = bytearray()
        for i, b in enumerate(ciphertext_bytes):
            plain_bytes.append(b ^ key_bytes[i % len(key_bytes)])

        plain_text = plain_bytes.decode("utf-8")
        try:
            return json.loads(plain_text)
        except Exception:
            return plain_text


class CursorTracker:
    """
    Tracks participant cursor positions and selections in terminal.
    """

    def __init__(self):
        self.cursors: Dict[str, Dict[str, Any]] = {}

    def update_cursor(
        self,
        participant_id: str,
        line: int = 0,
        col: int = 0,
        visible: bool = True,
        selection: Optional[Any] = None,
        name: str = "",
        color: str = "#00ff00",
    ) -> Dict[str, Any]:
        if not participant_id:
            raise ValueError("Participant ID required")

        existing = self.cursors.get(participant_id, {})
        cursor_data = {
            "participantId": participant_id,
            "line": max(0, int(line)),
            "col": max(0, int(col)),
            "visible": bool(visible),
            "selection": selection,
            "name": name or existing.get("name", participant_id),
            "color": color or existing.get("color", "#00ff00"),
            "updatedAt": int(time.time() * 1000),
        }
        self.cursors[participant_id] = cursor_data
        return cursor_data

    def get_cursor(self, participant_id: str) -> Optional[Dict[str, Any]]:
        return self.cursors.get(participant_id)

    def get_all_cursors(self) -> List[Dict[str, Any]]:
        return list(self.cursors.values())

    def remove_cursor(self, participant_id: str) -> bool:
        if participant_id in self.cursors:
            del self.cursors[participant_id]
            return True
        return False

    def clear(self) -> None:
        self.cursors.clear()


class PermissionManager:
    """
    Manages role-based write/control permissions for participants.
    """

    def __init__(self, default_role: Role = Role.VIEWER):
        self.default_role = default_role
        self.roles: Dict[str, Role] = {}
        self.pending_requests: Dict[str, Dict[str, Any]] = {}

    def set_role(self, participant_id: str, role: Role) -> None:
        if not participant_id:
            return
        if not isinstance(role, Role):
            role = Role(role)
        self.roles[participant_id] = role

    def get_role(self, participant_id: str) -> Role:
        return self.roles.get(participant_id, self.default_role)

    def can_write(self, participant_id: str) -> bool:
        role = self.get_role(participant_id)
        return role in (Role.HOST, Role.EDITOR)

    def request_control(self, participant_id: str, reason: str = "") -> Dict[str, Any]:
        if not participant_id:
            raise ValueError("Participant ID required")
        if self.can_write(participant_id):
            return {"participantId": participant_id, "status": "already_granted"}

        req = {
            "requestId": f"req_{int(time.time() * 1000)}_{secrets.token_hex(3)}",
            "participantId": participant_id,
            "reason": reason,
            "timestamp": int(time.time() * 1000),
            "status": "pending",
        }
        self.pending_requests[participant_id] = req
        return req

    def grant_control(self, participant_id: str) -> bool:
        if not participant_id:
            return False
        self.set_role(participant_id, Role.EDITOR)
        self.pending_requests.pop(participant_id, None)
        return True

    def revoke_control(self, participant_id: str) -> bool:
        if not participant_id:
            return False
        current_role = self.get_role(participant_id)
        if current_role == Role.HOST:
            raise PermissionError("Cannot revoke write permission from Host")
        self.set_role(participant_id, Role.VIEWER)
        return True

    def reject_request(self, participant_id: str) -> bool:
        if participant_id in self.pending_requests:
            self.pending_requests[participant_id]["status"] = "rejected"
            del self.pending_requests[participant_id]
            return True
        return False

    def get_pending_requests(self) -> List[Dict[str, Any]]:
        return list(self.pending_requests.values())


class SessionRecorder:
    """
    Session recording engine exporting Asciinema v2 and JSON event logs.
    """

    def __init__(self):
        self.frames: List[Dict[str, Any]] = []
        self.is_recording = False
        self.is_paused = False
        self.start_time: Optional[float] = None
        self.pause_time: Optional[float] = None
        self.total_paused_duration = 0.0

    def start(self) -> None:
        self.frames = []
        self.is_recording = True
        self.is_paused = False
        self.start_time = time.time()
        self.total_paused_duration = 0.0

    def pause(self) -> None:
        if self.is_recording and not self.is_paused:
            self.is_paused = True
            self.pause_time = time.time()

    def resume(self) -> None:
        if self.is_recording and self.is_paused and self.pause_time:
            self.total_paused_duration += time.time() - self.pause_time
            self.is_paused = False
            self.pause_time = None

    def stop(self) -> None:
        if self.is_recording:
            if self.is_paused:
                self.resume()
            self.is_recording = False

    def record_frame(self, event: EventType, payload: Any, participant_id: str = "host") -> Optional[Dict[str, Any]]:
        if not self.is_recording or self.is_paused or not self.start_time:
            return None

        elapsed = time.time() - self.start_time - self.total_paused_duration
        frame = {
            "timestamp": round(elapsed, 3),
            "event": event.value if isinstance(event, EventType) else event,
            "payload": payload,
            "participantId": participant_id,
        }
        self.frames.append(frame)
        return frame

    def get_frames(self) -> List[Dict[str, Any]]:
        return list(self.frames)

    def export_json(self) -> str:
        return json.dumps(
            {
                "version": 1,
                "recordingDate": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "totalFrames": len(self.frames),
                "frames": self.frames,
            },
            indent=2,
        )

    def export_asciinema(self, width: int = 80, height: int = 24, title: str = "CmdBar Terminal Session") -> str:
        header = json.dumps({
            "version": 2,
            "width": width,
            "height": height,
            "timestamp": int(self.start_time or time.time()),
            "title": title,
            "env": {"TERM": "xterm-256color"},
        })
        lines = [header]
        for f in self.frames:
            evt = f["event"]
            if evt == EventType.OUTPUT.value:
                txt = f["payload"] if isinstance(f["payload"], str) else json.dumps(f["payload"])
                lines.append(json.dumps([f["timestamp"], "o", txt]))
            elif evt == EventType.INPUT.value:
                txt = f["payload"] if isinstance(f["payload"], str) else json.dumps(f["payload"])
                lines.append(json.dumps([f["timestamp"], "i", txt]))
        return "\n".join(lines)

    def clear(self) -> None:
        self.frames.clear()
        self.is_recording = False
        self.is_paused = False
        self.start_time = None


class TerminalSharingSession:
    """
    Main Live Terminal Sharing Session in Python backend companion.
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        title: str = "CmdBar Shared Terminal",
        host: Optional[Dict[str, str]] = None,
        max_participants: int = 10,
        e2e_enabled: bool = True,
        secret_key: Optional[str] = None,
        default_role: Role = Role.VIEWER,
    ):
        self.session_id = session_id or f"session_{int(time.time() * 1000)}_{secrets.token_hex(3)}"
        self.title = title
        self.host = host or {"id": "host", "name": "Session Host", "email": "host@cmdbar.local"}
        self.max_participants = max_participants
        self.state = SessionState.IDLE
        self.participants: Dict[str, Dict[str, Any]] = {}

        self.e2e_enabled = e2e_enabled
        self.encryption_manager = E2EEncryptionManager(secret_key)
        self.cursor_tracker = CursorTracker()
        self.permission_manager = PermissionManager(default_role)
        self.recorder = SessionRecorder()

        self.metrics = {
            "framesProcessed": 0,
            "totalBytesStreamed": 0,
            "processingLatenciesMs": [],
            "startTimeMs": None,
        }

    def start(self) -> "TerminalSharingSession":
        if self.state == SessionState.ACTIVE:
            return self

        self.state = SessionState.ACTIVE
        self.metrics["startTimeMs"] = int(time.time() * 1000)

        host_participant = {
            "id": self.host["id"],
            "name": self.host["name"],
            "email": self.host.get("email", ""),
            "role": Role.HOST.value,
            "joinedAt": int(time.time() * 1000),
        }
        self.participants[self.host["id"]] = host_participant
        self.permission_manager.set_role(self.host["id"], Role.HOST)
        self.cursor_tracker.update_cursor(self.host["id"], line=0, col=0, name=self.host["name"])
        return self

    def join_participant(self, participant_info: Dict[str, str]) -> Dict[str, Any]:
        if self.state != SessionState.ACTIVE:
            raise RuntimeError("Cannot join inactive session")
        if len(self.participants) >= self.max_participants:
            raise RuntimeError(f"Participant limit ({self.max_participants}) reached")

        p_id = participant_info.get("id") or f"peer_{secrets.token_hex(3)}"
        role_val = participant_info.get("role", self.permission_manager.default_role.value)
        role = Role(role_val)

        participant = {
            "id": p_id,
            "name": participant_info.get("name", p_id),
            "email": participant_info.get("email", ""),
            "role": role.value,
            "joinedAt": int(time.time() * 1000),
        }

        self.participants[p_id] = participant
        self.permission_manager.set_role(p_id, role)
        self.cursor_tracker.update_cursor(p_id, line=0, col=0, name=participant["name"])

        if self.recorder.is_recording:
            self.recorder.record_frame(EventType.PEER_JOIN, participant, p_id)

        return participant

    def leave_participant(self, participant_id: str) -> bool:
        if participant_id not in self.participants:
            return False

        if self.recorder.is_recording:
            self.recorder.record_frame(EventType.PEER_LEAVE, {"participantId": participant_id}, participant_id)

        del self.participants[participant_id]
        self.cursor_tracker.remove_cursor(participant_id)
        return True

    def broadcast_output(self, stdout_or_stderr: Union[str, Dict]) -> Dict[str, Any]:
        t0 = time.time()
        if self.state != SessionState.ACTIVE:
            raise RuntimeError("Session is not active")

        payload = stdout_or_stderr if isinstance(stdout_or_stderr, str) else json.dumps(stdout_or_stderr)

        if self.recorder.is_recording:
            self.recorder.record_frame(EventType.OUTPUT, payload, self.host["id"])

        frame = {
            "type": EventType.OUTPUT.value,
            "sessionId": self.session_id,
            "senderId": self.host["id"],
            "timestamp": int(time.time() * 1000),
            "payload": self.encryption_manager.encrypt(payload) if self.e2e_enabled else payload,
            "isEncrypted": self.e2e_enabled,
        }

        latency_ms = (time.time() - t0) * 1000
        self.metrics["framesProcessed"] += 1
        self.metrics["totalBytesStreamed"] += len(payload)
        self.metrics["processingLatenciesMs"].append(latency_ms)
        return frame

    def send_input(self, participant_id: str, input_data: Union[str, Dict]) -> Dict[str, Any]:
        t0 = time.time()
        if self.state != SessionState.ACTIVE:
            raise RuntimeError("Session is not active")

        if not self.permission_manager.can_write(participant_id):
            raise PermissionError(f"Participant '{participant_id}' does not have write permission")

        payload = input_data if isinstance(input_data, str) else json.dumps(input_data)

        if self.recorder.is_recording:
            self.recorder.record_frame(EventType.INPUT, payload, participant_id)

        frame = {
            "type": EventType.INPUT.value,
            "sessionId": self.session_id,
            "senderId": participant_id,
            "timestamp": int(time.time() * 1000),
            "payload": self.encryption_manager.encrypt(payload) if self.e2e_enabled else payload,
            "isEncrypted": self.e2e_enabled,
        }

        latency_ms = (time.time() - t0) * 1000
        self.metrics["framesProcessed"] += 1
        self.metrics["totalBytesStreamed"] += len(payload)
        self.metrics["processingLatenciesMs"].append(latency_ms)
        return frame

    def update_cursor_position(self, participant_id: str, line: int = 0, col: int = 0, **kwargs) -> Dict[str, Any]:
        if self.state != SessionState.ACTIVE:
            raise RuntimeError("Session is not active")

        updated = self.cursor_tracker.update_cursor(participant_id, line=line, col=col, **kwargs)
        if self.recorder.is_recording:
            self.recorder.record_frame(EventType.CURSOR, updated, participant_id)
        return updated

    def request_input_permission(self, participant_id: str, reason: str = "") -> Dict[str, Any]:
        return self.permission_manager.request_control(participant_id, reason)

    def grant_input_permission(self, host_id: str, target_participant_id: str) -> bool:
        if not self.permission_manager.can_write(host_id):
            raise PermissionError("Only host or editors can grant write permissions")
        granted = self.permission_manager.grant_control(target_participant_id)
        if granted and target_participant_id in self.participants:
            self.participants[target_participant_id]["role"] = Role.EDITOR.value
        return granted

    def revoke_input_permission(self, host_id: str, target_participant_id: str) -> bool:
        if self.permission_manager.get_role(host_id) != Role.HOST:
            raise PermissionError("Only Host can revoke write permissions")
        revoked = self.permission_manager.revoke_control(target_participant_id)
        if revoked and target_participant_id in self.participants:
            self.participants[target_participant_id]["role"] = Role.VIEWER.value
        return revoked

    def start_recording(self) -> None:
        self.recorder.start()

    def pause_recording(self) -> None:
        self.recorder.pause()

    def resume_recording(self) -> None:
        self.recorder.resume()

    def stop_recording(self) -> None:
        self.recorder.stop()

    def export_recording(self, format_type: str = "asciinema", **kwargs) -> str:
        if format_type == "asciinema":
            return self.recorder.export_asciinema(**kwargs)
        elif format_type == "json":
            return self.recorder.export_json()
        raise ValueError(f"Unsupported recording format: {format_type}")

    def get_metrics(self) -> Dict[str, Any]:
        latencies = self.metrics["processingLatenciesMs"]
        avg_lat = sum(latencies) / len(latencies) if latencies else 0.0
        max_lat = max(latencies) if latencies else 0.0
        duration = (int(time.time() * 1000) - self.metrics["startTimeMs"]) / 1000.0 if self.metrics["startTimeMs"] else 0.0

        return {
            "sessionId": self.session_id,
            "state": self.state.value,
            "activeParticipants": len(self.participants),
            "framesProcessed": self.metrics["framesProcessed"],
            "totalBytesStreamed": self.metrics["totalBytesStreamed"],
            "avgLatencyMs": round(avg_lat, 2),
            "maxLatencyMs": max_lat,
            "durationSec": round(duration, 1),
            "e2eEncrypted": self.e2e_enabled,
        }

    def end_session(self) -> None:
        if self.state == SessionState.ENDED:
            return
        self.stop_recording()
        self.state = SessionState.ENDED
        self.participants.clear()
        self.cursor_tracker.clear()
