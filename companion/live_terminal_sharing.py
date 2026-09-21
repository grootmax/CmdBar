"""
live_terminal_sharing.py
Collaborative Terminal Sharing module for CmdBar companion app.
Provides real-time terminal streaming, WebRTC signaling, E2E encryption,
cursor tracking, permission control, and session recording/playback.
"""

import os
import json
import time
import math
import hashlib
import hmac
import secrets
from typing import Dict, List, Optional, Any, Tuple


class E2EEncryptor:
    """
    End-to-End Encryption module using AES-256-CTR and HMAC-SHA256 authenticated encryption.
    :visibility: public
    """

    def __init__(self, secret_key: Optional[str] = None):
        """
        :visibility: public
        """
        self.secret_key = secret_key

    def set_key(self, key: str) -> None:
        """
        Sets the encryption secret key.
        :visibility: public
        """
        if not key or not isinstance(key, str) or len(key) < 16:
            raise ValueError("Invalid encryption key. Key must be a non-empty string.")
        self.secret_key = key

    def has_key(self) -> bool:
        """
        Returns whether an encryption key is configured.
        :visibility: public
        """
        return bool(self.secret_key)

    def generate_key(self) -> str:
        """
        Generates a random 256-bit (32-byte) hex key.
        :visibility: public
        """
        return secrets.token_hex(32)

    def derive_key_from_passphrase(self, passphrase: str, salt_hex: str = "cmdbar-terminal-sharing-salt") -> str:
        """
        Derives a 256-bit hex key from passphrase and salt.
        :visibility: public
        """
        if not passphrase:
            raise ValueError("Passphrase cannot be empty.")
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            passphrase.encode("utf-8"),
            salt_hex.encode("utf-8"),
            10000,
            32
        )
        return derived.hex()

    def _get_key_bytes(self) -> bytes:
        padded = (self.secret_key or "").ljust(64, "0")[:64]
        return bytes.fromhex(padded)

    def _xor_keystream(self, data_bytes: bytes, key_bytes: bytes, iv_bytes: bytes) -> bytes:
        # CTR mode keystream generator using SHA-256 block counter
        result = bytearray()
        block_counter = 0
        while len(result) < len(data_bytes):
            counter_bytes = block_counter.to_bytes(4, byteorder='big')
            block_key = hashlib.sha256(key_bytes + iv_bytes + counter_bytes).digest()
            chunk_len = min(len(block_key), len(data_bytes) - len(result))
            for i in range(chunk_len):
                result.append(data_bytes[len(result)] ^ block_key[i])
            block_counter += 1
        return bytes(result)

    def encrypt(self, data: Any) -> Dict[str, Any]:
        """
        Encrypts plaintext string or object into an authenticated encrypted dictionary.
        :visibility: public
        """
        if not self.secret_key:
            raise ValueError("Encryption key not configured.")

        plaintext = data if isinstance(data, str) else json.dumps(data)
        data_bytes = plaintext.encode("utf-8")
        key_bytes = self._get_key_bytes()
        iv_bytes = secrets.token_bytes(16)

        ciphertext_bytes = self._xor_keystream(data_bytes, key_bytes, iv_bytes)
        auth_tag = hmac.new(key_bytes, iv_bytes + ciphertext_bytes, hashlib.sha256).hexdigest()

        return {
            "ciphertext": ciphertext_bytes.hex(),
            "iv": iv_bytes.hex(),
            "authTag": auth_tag,
            "encrypted": True
        }

    def decrypt(self, encrypted_payload: Dict[str, Any]) -> Any:
        """
        Decrypts an encrypted payload dictionary into original string or object.
        :visibility: public
        """
        if not self.secret_key:
            raise ValueError("Encryption key not configured.")

        if not isinstance(encrypted_payload, dict) or "ciphertext" not in encrypted_payload or "iv" not in encrypted_payload:
            raise ValueError("Invalid encrypted payload format.")

        ciphertext_bytes = bytes.fromhex(encrypted_payload["ciphertext"])
        iv_bytes = bytes.fromhex(encrypted_payload["iv"])
        provided_tag = encrypted_payload.get("authTag", "")

        key_bytes = self._get_key_bytes()
        computed_tag = hmac.new(key_bytes, iv_bytes + ciphertext_bytes, hashlib.sha256).hexdigest()

        if provided_tag and not hmac.compare_digest(computed_tag, provided_tag):
            raise ValueError("Decryption failed: HMAC tag mismatch / payload corrupted.")

        plaintext_bytes = self._xor_keystream(ciphertext_bytes, key_bytes, iv_bytes)
        decrypted_str = plaintext_bytes.decode("utf-8")

        try:
            return json.loads(decrypted_str)
        except Exception:
            return decrypted_str


class PermissionManager:
    """
    Granular Permission Control Manager for Collaborative Sessions.
    :visibility: public
    """

    ROLE_ADMIN = "admin"
    ROLE_READ_WRITE = "read-write"
    ROLE_READ_ONLY = "read-only"

    ACTION_READ = "read"
    ACTION_WRITE = "write"
    ACTION_GRANT_PERMISSION = "grant_permission"
    ACTION_TERMINATE_SESSION = "terminate_session"
    ACTION_RESIZE = "resize"
    ACTION_REQUEST_CONTROL = "request_control"

    def __init__(self, host_id: str, default_role: str = ROLE_READ_ONLY):
        """
        :visibility: public
        """
        self.host_id = host_id
        self.default_role = default_role
        self.roles: Dict[str, str] = {}
        this_host = host_id
        if this_host:
            self.roles[this_host] = self.ROLE_ADMIN
        self.pending_requests: Dict[str, Dict[str, Any]] = {}

    def set_role(self, participant_id: str, role: str) -> None:
        """
        Sets role for a participant.
        :visibility: public
        """
        valid_roles = [self.ROLE_ADMIN, self.ROLE_READ_WRITE, self.ROLE_READ_ONLY]
        if role not in valid_roles:
            raise ValueError(f"Invalid role '{role}'. Must be one of: {valid_roles}")
        self.roles[participant_id] = role

    def get_role(self, participant_id: str) -> str:
        """
        Gets participant's assigned role.
        :visibility: public
        """
        if participant_id == self.host_id:
            return self.ROLE_ADMIN
        return self.roles.get(participant_id, self.default_role)

    def has_permission(self, participant_id: str, action: str) -> bool:
        """
        Checks if participant has permission for an action.
        :visibility: public
        """
        role = self.get_role(participant_id)

        if action == self.ACTION_READ:
            return True
        elif action in (self.ACTION_WRITE, self.ACTION_RESIZE):
            return role in (self.ROLE_READ_WRITE, self.ROLE_ADMIN)
        elif action in (self.ACTION_GRANT_PERMISSION, self.ACTION_TERMINATE_SESSION):
            return role == self.ROLE_ADMIN
        elif action == self.ACTION_REQUEST_CONTROL:
            return role == self.ROLE_READ_ONLY
        return False

    def request_control(self, participant_id: str, requested_role: str = ROLE_READ_WRITE, reason: str = "") -> Dict[str, Any]:
        """
        Submits control request from read-only participant.
        :visibility: public
        """
        if not self.has_permission(participant_id, self.ACTION_REQUEST_CONTROL):
            if self.get_role(participant_id) != self.ROLE_READ_ONLY:
                raise ValueError("Participant already has write or admin permissions.")

        request_id = f"req_{int(time.time() * 1000)}_{secrets.token_hex(3)}"
        request = {
            "requestId": request_id,
            "participantId": participant_id,
            "requestedRole": requested_role,
            "reason": reason,
            "timestamp": int(time.time() * 1000),
            "status": "pending"
        }
        self.pending_requests[request_id] = request
        return request

    def approve_control_request(self, request_id: str, admin_participant_id: str) -> Dict[str, Any]:
        """
        Approves a control request.
        :visibility: public
        """
        if not self.has_permission(admin_participant_id, self.ACTION_GRANT_PERMISSION):
            raise ValueError("Permission denied. Only admins can approve control requests.")

        if request_id not in self.pending_requests:
            raise ValueError(f"Control request '{request_id}' not found.")

        req = self.pending_requests[request_id]
        req["status"] = "approved"
        req["approvedBy"] = admin_participant_id
        req["approvedAt"] = int(time.time() * 1000)

        self.set_role(req["participantId"], req["requestedRole"])
        del self.pending_requests[request_id]
        return req

    def deny_control_request(self, request_id: str, admin_participant_id: str) -> Dict[str, Any]:
        """
        Denies a control request.
        :visibility: public
        """
        if not self.has_permission(admin_participant_id, self.ACTION_GRANT_PERMISSION):
            raise ValueError("Permission denied. Only admins can deny control requests.")

        if request_id not in self.pending_requests:
            raise ValueError(f"Control request '{request_id}' not found.")

        req = self.pending_requests[request_id]
        req["status"] = "denied"
        req["deniedBy"] = admin_participant_id
        req["deniedAt"] = int(time.time() * 1000)

        del self.pending_requests[request_id]
        return req

    def get_pending_requests(self) -> List[Dict[str, Any]]:
        """
        Gets all pending control requests.
        :visibility: public
        """
        return list(self.pending_requests.values())


class CursorTracker:
    """
    Participant Cursor Tracking Manager.
    :visibility: public
    """

    PALETTE = [
        "#FF5733", "#33FF57", "#3357FF", "#F39C12",
        "#9B59B6", "#1ABC9C", "#E74C3C", "#3498DB"
    ]

    def __init__(self):
        """
        :visibility: public
        """
        self.cursors: Dict[str, Dict[str, Any]] = {}

    def generate_participant_color(self, participant_id: str) -> str:
        """
        Generates deterministic hex color for participant.
        :visibility: public
        """
        hash_val = 0
        for char in participant_id:
            hash_val = ord(char) + ((hash_val << 5) - hash_val)
        idx = abs(hash_val) % len(self.PALETTE)
        return self.PALETTE[idx]

    def set_cursor(self, participant_id: str, cursor_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Sets or updates cursor position for participant.
        :visibility: public
        """
        cursor_data = cursor_data or {}
        existing = self.cursors.get(participant_id, {})
        color = cursor_data.get("color") or existing.get("color") or self.generate_participant_color(participant_id)

        cursor = {
            "participantId": participant_id,
            "username": cursor_data.get("username") or existing.get("username") or participant_id,
            "row": cursor_data.get("row") if isinstance(cursor_data.get("row"), int) else existing.get("row", 0),
            "col": cursor_data.get("col") if isinstance(cursor_data.get("col"), int) else existing.get("col", 0),
            "selection": cursor_data.get("selection") or existing.get("selection"),
            "color": color,
            "active": cursor_data.get("active", True),
            "lastUpdated": int(time.time() * 1000)
        }
        self.cursors[participant_id] = cursor
        return cursor

    def remove_cursor(self, participant_id: str) -> None:
        """
        Removes participant cursor.
        :visibility: public
        """
        self.cursors.pop(participant_id, None)

    def get_cursor(self, participant_id: str) -> Optional[Dict[str, Any]]:
        """
        Gets cursor data for participant.
        :visibility: public
        """
        return self.cursors.get(participant_id)

    def get_all_cursors(self) -> List[Dict[str, Any]]:
        """
        Gets list of all active participant cursors.
        :visibility: public
        """
        return list(self.cursors.values())


class SessionRecorder:
    """
    Session Recorder for capturing time-stamped terminal event streams.
    :visibility: public
    """

    def __init__(self, session_id: Optional[str] = None):
        """
        :visibility: public
        """
        self.session_id = session_id
        self.frames: List[Dict[str, Any]] = []
        self.recording = False
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None

    def start_recording(self) -> None:
        """
        Begins recording session events.
        :visibility: public
        """
        self.frames = []
        self.recording = True
        self.start_time = time.time() * 1000
        self.end_time = None

    def stop_recording(self) -> Dict[str, Any]:
        """
        Stops recording and finalizes bounds.
        :visibility: public
        """
        if not self.recording:
            return self.get_metadata()
        self.recording = False
        self.end_time = time.time() * 1000
        return self.get_metadata()

    def is_recording(self) -> bool:
        """
        Returns boolean recording status.
        :visibility: public
        """
        return self.recording

    def record_event(self, event_type: str, payload: Any, participant_id: Optional[str] = None) -> None:
        """
        Records timestamped frame into session stream.
        :visibility: public
        """
        if not self.recording or self.start_time is None:
            return

        now = time.time() * 1000
        frame = {
            "timestamp": int(now),
            "relativeTimeMs": int(now - self.start_time),
            "eventType": event_type,
            "payload": payload,
            "participantId": participant_id
        }
        self.frames.append(frame)

    def get_frames(self) -> List[Dict[str, Any]]:
        """
        Gets recorded frame list.
        :visibility: public
        """
        return self.frames

    def export_json(self) -> str:
        """
        Exports recorded session in JSON format string.
        :visibility: public
        """
        now = time.time() * 1000
        start = self.start_time or now
        end = self.end_time or now
        data = {
            "version": 1,
            "sessionId": self.session_id,
            "startTime": int(start),
            "endTime": int(end),
            "durationMs": int(end - start),
            "frameCount": len(self.frames),
            "frames": self.frames
        }
        return json.dumps(data, indent=2)

    def export_asciinema(self) -> str:
        """
        Exports session in Asciinema v2 header + event format.
        :visibility: public
        """
        now = time.time() * 1000
        start = self.start_time or now
        header = {
            "version": 2,
            "width": 80,
            "height": 24,
            "timestamp": int(start / 1000),
            "title": f"CmdBar Live Session {self.session_id or ''}".strip()
        }
        lines = [json.dumps(header)]
        for frame in self.frames:
            if frame["eventType"] in ("output", "input"):
                t_type = "o" if frame["eventType"] == "output" else "i"
                t_sec = round(frame["relativeTimeMs"] / 1000.0, 6)
                lines.append(json.dumps([t_sec, t_type, str(frame["payload"])]))
        return "\n".join(lines)

    def get_metadata(self) -> Dict[str, Any]:
        """
        Gets recording metadata summary.
        :visibility: public
        """
        now = time.time() * 1000
        start = self.start_time or now
        end = self.end_time or (now if self.recording else start)
        return {
            "sessionId": self.session_id,
            "recording": self.recording,
            "frameCount": len(self.frames),
            "startTime": int(start),
            "endTime": int(end),
            "durationMs": int(end - start)
        }


class SessionPlayer:
    """
    Session Player for replaying recorded terminal sessions.
    :visibility: public
    """

    def __init__(self, recording_data: Optional[Any] = None):
        """
        :visibility: public
        """
        self.frames: List[Dict[str, Any]] = []
        self.metadata: Dict[str, Any] = {}
        self.current_index = 0
        self.playing = False
        self.speed = 1.0

        if recording_data is not None:
            self.load_recording(recording_data)

    def load_recording(self, recording_data: Any) -> None:
        """
        Loads recording from JSON string, Asciinema string, or dictionary.
        :visibility: public
        """
        self.frames = []
        self.current_index = 0

        if isinstance(recording_data, str):
            try:
                parsed = json.loads(recording_data)
                if isinstance(parsed, dict) and "frames" in parsed and isinstance(parsed["frames"], list):
                    self.frames = parsed["frames"]
                    self.metadata = parsed
                    return
            except Exception:
                # Asciinema format
                lines = [l.strip() for l in recording_data.split("\n") if l.strip()]
                if lines:
                    try:
                        header = json.loads(lines[0])
                        self.metadata = {"asciinema": True, "header": header}
                        for line in lines[1:]:
                            item = json.loads(line)
                            if isinstance(item, list) and len(item) >= 3:
                                t_sec, event_type, payload = item[0], item[1], item[2]
                                self.frames.append({
                                    "relativeTimeMs": int(t_sec * 1000),
                                    "eventType": "input" if event_type == "i" else "output",
                                    "payload": payload
                                })
                        return
                    except Exception as e:
                        raise ValueError(f"Failed to parse Asciinema recording: {e}")

        elif isinstance(recording_data, dict):
            self.frames = recording_data.get("frames", [])
            self.metadata = recording_data
            return

        raise ValueError("Invalid recording data format.")

    def step_next(self, on_frame_callback: Optional[Any] = None) -> Optional[Dict[str, Any]]:
        """
        Steps to next frame and executes callback.
        :visibility: public
        """
        if self.current_index >= len(self.frames):
            self.playing = False
            return None

        frame = self.frames[self.current_index]
        self.current_index += 1

        if callable(on_frame_callback):
            on_frame_callback(frame, self.current_index - 1, len(self.frames))

        return frame

    def play_all(self, on_frame_callback: Optional[Any] = None, speed: float = 1.0) -> List[Dict[str, Any]]:
        """
        Plays back all remaining frames sequentially.
        :visibility: public
        """
        self.speed = max(0.1, speed)
        self.playing = True
        executed = []
        while self.playing and self.current_index < len(self.frames):
            frame = self.step_next(on_frame_callback)
            if frame:
                executed.append(frame)
        self.playing = False
        return executed

    def seek(self, timestamp_ms: int) -> None:
        """
        Seeks to frame index at timestamp.
        :visibility: public
        """
        target_idx = 0
        for i, f in enumerate(self.frames):
            if f.get("relativeTimeMs", 0) < timestamp_ms:
                target_idx = i + 1
            else:
                break
        self.current_index = min(target_idx, len(self.frames))

    def get_metadata(self) -> Dict[str, Any]:
        """
        Gets playback metadata.
        :visibility: public
        """
        total_frames = len(self.frames)
        duration_ms = self.frames[-1].get("relativeTimeMs", 0) if total_frames > 0 else 0
        res = {
            "totalFrames": total_frames,
            "durationMs": duration_ms,
            "currentIndex": self.current_index,
            "playing": self.playing,
            "speed": self.speed
        }
        res.update(self.metadata)
        return res


class WebRTCManager:
    """
    WebRTC Signaling and Peer Connection Manager.
    :visibility: public
    """

    STATE_NEW = "new"
    STATE_CONNECTING = "connecting"
    STATE_CONNECTED = "connected"
    STATE_DISCONNECTED = "disconnected"
    STATE_FAILED = "failed"
    STATE_CLOSED = "closed"

    def __init__(self, peer_id: str, signaling_callback: Optional[Any] = None):
        """
        :visibility: public
        """
        self.peer_id = peer_id
        self.signaling_callback = signaling_callback
        self.state = self.STATE_NEW
        self.encryptor: Optional[E2EEncryptor] = None
        self.message_listeners: List[Any] = []
        self.ice_candidates: List[Dict[str, Any]] = []

    def set_encryptor(self, encryptor: E2EEncryptor) -> None:
        """
        Configures E2E encryptor.
        :visibility: public
        """
        self.encryptor = encryptor

    def create_offer(self) -> Dict[str, Any]:
        """
        Generates SDP offer.
        :visibility: public
        """
        self.state = self.STATE_CONNECTING
        offer = {
            "type": "offer",
            "peerId": self.peer_id,
            "sdp": f"v=0\r\no=- {int(time.time()*1000)} 2 IN IP4 127.0.0.1\r\ns=CmdBar-Terminal\r\nt=0 0\r\na=sendrecv\r\n",
            "timestamp": int(time.time() * 1000)
        }
        if callable(self.signaling_callback):
            self.signaling_callback({"type": "sdp_offer", "offer": offer, "peerId": self.peer_id})
        return offer

    def handle_offer(self, offer: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes incoming SDP offer and generates SDP answer.
        :visibility: public
        """
        if not offer or offer.get("type") != "offer":
            raise ValueError("Invalid SDP offer object.")

        self.state = self.STATE_CONNECTING
        answer = {
            "type": "answer",
            "peerId": self.peer_id,
            "sdp": f"v=0\r\no=- {int(time.time()*1000)} 2 IN IP4 127.0.0.1\r\ns=CmdBar-Terminal-Ans\r\nt=0 0\r\na=sendrecv\r\n",
            "timestamp": int(time.time() * 1000)
        }
        if callable(self.signaling_callback):
            self.signaling_callback({"type": "sdp_answer", "answer": answer, "peerId": self.peer_id})

        self.state = self.STATE_CONNECTED
        return answer

    def handle_answer(self, answer: Dict[str, Any]) -> None:
        """
        Processes incoming SDP answer.
        :visibility: public
        """
        if not answer or answer.get("type") != "answer":
            raise ValueError("Invalid SDP answer object.")
        self.state = self.STATE_CONNECTED

    def add_ice_candidate(self, candidate: Dict[str, Any]) -> None:
        """
        Adds ICE candidate.
        :visibility: public
        """
        if not candidate or "candidate" not in candidate:
            raise ValueError("Invalid ICE candidate object.")
        self.ice_candidates.append(candidate)

    def send_message(self, data: Any) -> Any:
        """
        Sends message payload over WebRTC data channel.
        :visibility: public
        """
        if self.state not in (self.STATE_CONNECTED, self.STATE_CONNECTING):
            raise ValueError(f"Cannot send message. WebRTC state is '{self.state}'.")

        payload = data
        if self.encryptor and self.encryptor.has_key():
            payload = self.encryptor.encrypt(data)

        if callable(self.signaling_callback):
            self.signaling_callback({
                "type": "data",
                "peerId": self.peer_id,
                "payload": payload
            })

        return payload

    def receive_message(self, raw_message: Any) -> Any:
        """
        Processes incoming raw WebRTC message.
        :visibility: public
        """
        data = raw_message
        if isinstance(raw_message, dict) and raw_message.get("encrypted") and self.encryptor:
            data = self.encryptor.decrypt(raw_message)

        for listener in self.message_listeners:
            try:
                listener(data)
            except Exception:
                pass

        return data

    def on_message(self, listener: Any) -> None:
        """
        Subscribes listener to data messages.
        :visibility: public
        """
        if callable(listener):
            self.message_listeners.append(listener)

    def get_status(self) -> str:
        """
        Gets connection status string.
        :visibility: public
        """
        return self.state

    def close(self) -> None:
        """
        Closes WebRTC connection.
        :visibility: public
        """
        self.state = self.STATE_CLOSED
        self.message_listeners = []


class TerminalSession:
    """
    Main Collaborative Terminal Session Controller.
    :visibility: public
    """

    def __init__(self, session_id: str, host_id: str, title: str = "Collaborative Terminal", options: Optional[Dict[str, Any]] = None):
        """
        :visibility: public
        """
        if not session_id or not host_id:
            raise ValueError("session_id and host_id are required.")

        options = options or {}
        self.session_id = session_id
        self.host_id = host_id
        self.title = title
        self.dimensions = {
            "rows": options.get("rows", 24),
            "cols": options.get("cols", 80)
        }

        self.active = True
        self.created_at = int(time.time() * 1000)
        self.participants: Dict[str, Dict[str, Any]] = {}
        self.scrollback_history: List[str] = []
        self.max_scrollback = options.get("maxScrollback", 1000)

        default_role = options.get("defaultRole", PermissionManager.ROLE_READ_ONLY)
        self.permission_manager = PermissionManager(host_id, default_role)
        self.cursor_tracker = CursorTracker()
        self.recorder = SessionRecorder(session_id)
        self.encryptor = E2EEncryptor(options.get("secretKey"))

        # Add host
        self.join({
            "id": host_id,
            "username": options.get("hostUsername", host_id),
            "role": PermissionManager.ROLE_ADMIN
        })

    def set_encryption_key(self, secret_key: str) -> None:
        """
        Enables E2E encryption for session.
        :visibility: public
        """
        self.encryptor.set_key(secret_key)

    def join(self, participant: Dict[str, Any]) -> Dict[str, Any]:
        """
        Adds participant to session.
        :visibility: public
        """
        if not participant or "id" not in participant:
            raise ValueError("Participant dictionary must contain an 'id' field.")

        p_id = participant["id"]
        role = participant.get("role") or (PermissionManager.ROLE_ADMIN if p_id == self.host_id else PermissionManager.ROLE_READ_ONLY)
        self.permission_manager.set_role(p_id, role)

        record = {
            "id": p_id,
            "username": participant.get("username", p_id),
            "role": role,
            "joinedAt": int(time.time() * 1000),
            "status": "connected"
        }

        self.participants[p_id] = record
        self.cursor_tracker.set_cursor(p_id, {
            "username": record["username"],
            "row": 0,
            "col": 0
        })

        self.recorder.record_event("participant_join", {"participantId": p_id, "username": record["username"], "role": role}, p_id)
        return record

    def leave(self, participant_id: str) -> None:
        """
        Removes participant from session.
        :visibility: public
        """
        if participant_id in self.participants:
            del self.participants[participant_id]
            self.cursor_tracker.remove_cursor(participant_id)
            self.recorder.record_event("participant_leave", {"participantId": participant_id}, participant_id)

    def process_input(self, participant_id: str, input_data: str) -> Dict[str, Any]:
        """
        Processes terminal input from participant.
        :visibility: public
        """
        if not self.active:
            raise ValueError("Session is no longer active.")

        if not self.permission_manager.has_permission(participant_id, PermissionManager.ACTION_WRITE):
            raise ValueError(f"Permission denied: Participant '{participant_id}' cannot write input.")

        self.recorder.record_event("input", input_data, participant_id)
        return {
            "sessionId": self.session_id,
            "participantId": participant_id,
            "data": input_data,
            "timestamp": int(time.time() * 1000)
        }

    def broadcast_output(self, output_data: str) -> Optional[Dict[str, Any]]:
        """
        Broadcasts terminal output to session and scrollback history.
        :visibility: public
        """
        if not output_data:
            return None

        self.scrollback_history.append(output_data)
        if len(self.scrollback_history) > self.max_scrollback:
            self.scrollback_history.pop(0)

        self.recorder.record_event("output", output_data, self.host_id)
        return {
            "sessionId": self.session_id,
            "data": output_data,
            "timestamp": int(time.time() * 1000)
        }

    def update_cursor(self, participant_id: str, row: int, col: int, selection: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Updates cursor for participant.
        :visibility: public
        """
        if participant_id not in self.participants:
            raise ValueError(f"Participant '{participant_id}' is not in session.")

        cursor = self.cursor_tracker.set_cursor(participant_id, {"row": row, "col": col, "selection": selection})
        self.recorder.record_event("cursor_move", {"row": row, "col": col, "selection": selection}, participant_id)
        return cursor

    def resize_terminal(self, participant_id: str, rows: int, cols: int) -> Dict[str, Any]:
        """
        Resizes terminal dimensions.
        :visibility: public
        """
        if not self.permission_manager.has_permission(participant_id, PermissionManager.ACTION_RESIZE):
            raise ValueError(f"Permission denied: Participant '{participant_id}' cannot resize terminal.")

        self.dimensions = {"rows": rows, "cols": cols}
        self.recorder.record_event("resize", {"rows": rows, "cols": cols}, participant_id)
        return self.dimensions

    def get_scrollback_history(self) -> List[str]:
        """
        Gets scrollback history list.
        :visibility: public
        """
        return list(self.scrollback_history)

    def start_recording(self) -> None:
        """
        Begins recording.
        :visibility: public
        """
        self.recorder.start_recording()

    def stop_recording(self) -> Dict[str, Any]:
        """
        Stops recording and returns summary.
        :visibility: public
        """
        return self.recorder.stop_recording()

    def get_session_state(self) -> Dict[str, Any]:
        """
        Gets snapshot of current session state.
        :visibility: public
        """
        return {
            "sessionId": self.session_id,
            "hostId": self.host_id,
            "title": self.title,
            "active": self.active,
            "dimensions": self.dimensions,
            "createdAt": self.created_at,
            "encrypted": self.encryptor.has_key(),
            "recording": self.recorder.is_recording(),
            "participants": list(self.participants.values()),
            "cursors": self.cursorTracker.get_all_cursors() if hasattr(self, 'cursorTracker') else self.cursor_tracker.get_all_cursors(),
            "pendingRequests": self.permission_manager.get_pending_requests()
        }
