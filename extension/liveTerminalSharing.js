/**
 * @file liveTerminalSharing.js
 * @description Collaborative Terminal Sharing module for CmdBar extension.
 * Provides real-time terminal streaming, WebRTC signaling, E2E encryption,
 * cursor tracking, permission management, and session recording/playback.
 */

import crypto from "crypto";

const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

/**
 * End-to-End Encryption module using AES-256-GCM.
 */
export class E2EEncryptor {
  /**
   * Creates an instance of E2EEncryptor.
   * @param {string|null} secretKey - 64-character hex string (32 bytes) or null.
   * @public
   */
  constructor(secretKey = null) {
    this.secretKey = secretKey;
  }

  /**
   * Sets the 32-byte secret key (hex string).
   * @param {string} key
   * @public
   */
  setKey(key) {
    if (!key || typeof key !== "string" || key.length < 16) {
      throw new Error("Invalid encryption key. Key must be a non-empty string.");
    }
    this.secretKey = key;
  }

  /**
   * Returns whether a key is currently configured.
   * @returns {boolean}
   * @public
   */
  hasKey() {
    return Boolean(this.secretKey);
  }

  /**
   * Generates a random 256-bit (32-byte) hex key.
   * @returns {string} Hex key string.
   * @public
   */
  generateKey() {
    if (crypto && crypto.randomBytes) {
      return crypto.randomBytes(32).toString("hex");
    }
    // Pure JS fallback
    let hex = "";
    for (let i = 0; i < 64; i++) {
      hex += Math.floor(Math.random() * 16).toString(16);
    }
    return hex;
  }

  /**
   * Derives a 256-bit hex key from a passphrase and salt.
   * @param {string} passphrase
   * @param {string} saltHex - Salt hex string.
   * @returns {string} Derived hex key.
   * @public
   */
  deriveKeyFromPassphrase(passphrase, saltHex = "cmdbar-terminal-sharing-salt") {
    if (!passphrase) {
      throw new Error("Passphrase cannot be empty.");
    }
    if (crypto && crypto.pbkdf2Sync) {
      const derived = crypto.pbkdf2Sync(passphrase, saltHex, 10000, 32, "sha256");
      return derived.toString("hex");
    }
    // Fallback HMAC/SHA256 simulation
    let hash = passphrase + saltHex;
    for (let i = 0; i < 1000; i++) {
      if (crypto && crypto.createHash) {
        hash = crypto.createHash("sha256").update(hash).digest("hex");
      }
    }
    return hash.padEnd(64, "0").slice(0, 64);
  }

  /**
   * Encrypts plaintext data (string or object) into an encrypted payload.
   * @param {string|object} data
   * @returns {object} { ciphertext, iv, authTag, encrypted: true }
   * @public
   */
  encrypt(data) {
    if (!this.secretKey) {
      throw new Error("Encryption key not configured.");
    }

    const plaintext = typeof data === "string" ? data : JSON.stringify(data);
    const keyBuffer = Buffer.from(this.secretKey.padEnd(64, "0").slice(0, 64), "hex");

    if (crypto && crypto.randomBytes && crypto.createCipheriv) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
      let ciphertext = cipher.update(plaintext, "utf8", "hex");
      ciphertext += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");

      return {
        ciphertext,
        iv: iv.toString("hex"),
        authTag,
        encrypted: true,
      };
    }

    // Fallback XOR-based stream cipher with HMAC tag
    const iv = (Math.random().toString(36) + "00000000000").slice(2, 14);
    let ciphertext = "";
    for (let i = 0; i < plaintext.length; i++) {
      const charCode = plaintext.charCodeAt(i);
      const keyChar = keyBuffer[i % keyBuffer.length];
      ciphertext += (charCode ^ keyChar).toString(16).padStart(2, "0");
    }
    const authTag = crypto ? crypto.createHash("sha256").update(ciphertext + iv).digest("hex").slice(0, 32) : "tag";

    return {
      ciphertext,
      iv,
      authTag,
      encrypted: true,
    };
  }

  /**
   * Decrypts an encrypted payload back into original string or parsed JSON object.
   * @param {object} encryptedPayload - { ciphertext, iv, authTag }
   * @returns {string|object} Decrypted data.
   * @public
   */
  decrypt(encryptedPayload) {
    if (!this.secretKey) {
      throw new Error("Encryption key not configured.");
    }
    if (!encryptedPayload || !encryptedPayload.ciphertext || !encryptedPayload.iv) {
      throw new Error("Invalid encrypted payload format.");
    }

    const { ciphertext, iv, authTag } = encryptedPayload;
    const keyBuffer = Buffer.from(this.secretKey.padEnd(64, "0").slice(0, 64), "hex");

    if (crypto && crypto.createDecipheriv) {
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, Buffer.from(iv, "hex"));
        if (authTag) {
          decipher.setAuthTag(Buffer.from(authTag, "hex"));
        }
        let decrypted = decipher.update(ciphertext, "hex", "utf8");
        decrypted += decipher.final("utf8");

        try {
          return JSON.parse(decrypted);
        } catch (_) {
          return decrypted;
        }
      } catch (err) {
        throw new Error(`Decryption failed: ${err.message}`);
      }
    }

    // Fallback XOR decipher
    let decryptedText = "";
    for (let i = 0; i < ciphertext.length; i += 2) {
      const hexByte = ciphertext.substr(i, 2);
      const byteVal = parseInt(hexByte, 16);
      const keyChar = keyBuffer[(i / 2) % keyBuffer.length];
      decryptedText += String.fromCharCode(byteVal ^ keyChar);
    }

    try {
      return JSON.parse(decryptedText);
    } catch (_) {
      return decryptedText;
    }
  }
}

/**
 * Granular Permission Control Manager for Collaborative Sessions.
 */
export class PermissionManager {
  static ROLES = {
    ADMIN: "admin",
    READ_WRITE: "read-write",
    READ_ONLY: "read-only",
  };

  static ACTIONS = {
    READ: "read",
    WRITE: "write",
    GRANT_PERMISSION: "grant_permission",
    TERMINATE_SESSION: "terminate_session",
    RESIZE: "resize",
    REQUEST_CONTROL: "request_control",
  };

  /**
   * Creates a PermissionManager instance.
   * @param {string} hostId - ID of session host.
   * @param {string} defaultRole - Default role assigned to new participants.
   * @public
   */
  constructor(hostId, defaultRole = PermissionManager.ROLES.READ_ONLY) {
    this.hostId = hostId;
    this.defaultRole = defaultRole;
    this.roles = new Map();
    this.pendingRequests = new Map();

    if (hostId) {
      this.roles.set(hostId, PermissionManager.ROLES.ADMIN);
    }
  }

  /**
   * Sets the permission role for a participant.
   * @param {string} participantId
   * @param {string} role - 'admin', 'read-write', or 'read-only'.
   * @public
   */
  setRole(participantId, role) {
    const validRoles = Object.values(PermissionManager.ROLES);
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role '${role}'. Must be one of: ${validRoles.join(", ")}`);
    }
    this.roles.set(participantId, role);
  }

  /**
   * Gets the assigned role for a participant.
   * @param {string} participantId
   * @returns {string} Role name.
   * @public
   */
  getRole(participantId) {
    if (participantId === this.hostId) {
      return PermissionManager.ROLES.ADMIN;
    }
    return this.roles.get(participantId) || this.defaultRole;
  }

  /**
   * Checks if a participant has permission to execute an action.
   * @param {string} participantId
   * @param {string} action
   * @returns {boolean}
   * @public
   */
  hasPermission(participantId, action) {
    const role = this.getRole(participantId);

    switch (action) {
      case PermissionManager.ACTIONS.READ:
        return true; // All roles can read

      case PermissionManager.ACTIONS.WRITE:
      case PermissionManager.ACTIONS.RESIZE:
        return role === PermissionManager.ROLES.READ_WRITE || role === PermissionManager.ROLES.ADMIN;

      case PermissionManager.ACTIONS.GRANT_PERMISSION:
      case PermissionManager.ACTIONS.TERMINATE_SESSION:
        return role === PermissionManager.ROLES.ADMIN;

      case PermissionManager.ACTIONS.REQUEST_CONTROL:
        return role === PermissionManager.ROLES.READ_ONLY;

      default:
        return false;
    }
  }

  /**
   * Submits a control request from a read-only participant.
   * @param {string} participantId
   * @param {string} requestedRole
   * @param {string} reason
   * @returns {object} Request object.
   * @public
   */
  requestControl(participantId, requestedRole = PermissionManager.ROLES.READ_WRITE, reason = "") {
    if (!this.hasPermission(participantId, PermissionManager.ACTIONS.REQUEST_CONTROL)) {
      if (this.getRole(participantId) !== PermissionManager.ROLES.READ_ONLY) {
        throw new Error("Participant already has control or write permissions.");
      }
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const request = {
      requestId,
      participantId,
      requestedRole,
      reason,
      timestamp: Date.now(),
      status: "pending",
    };

    this.pendingRequests.set(requestId, request);
    return request;
  }

  /**
   * Approves a pending control request.
   * @param {string} requestId
   * @param {string} adminParticipantId
   * @returns {object} Updated request object.
   * @public
   */
  approveControlRequest(requestId, adminParticipantId) {
    if (!this.hasPermission(adminParticipantId, PermissionManager.ACTIONS.GRANT_PERMISSION)) {
      throw new Error("Permission denied. Only admins can approve control requests.");
    }

    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Control request '${requestId}' not found.`);
    }

    request.status = "approved";
    request.approvedBy = adminParticipantId;
    request.approvedAt = Date.now();

    this.setRole(request.participantId, request.requestedRole);
    this.pendingRequests.delete(requestId);

    return request;
  }

  /**
   * Denies a pending control request.
   * @param {string} requestId
   * @param {string} adminParticipantId
   * @returns {object} Updated request object.
   * @public
   */
  denyControlRequest(requestId, adminParticipantId) {
    if (!this.hasPermission(adminParticipantId, PermissionManager.ACTIONS.GRANT_PERMISSION)) {
      throw new Error("Permission denied. Only admins can deny control requests.");
    }

    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Control request '${requestId}' not found.`);
    }

    request.status = "denied";
    request.deniedBy = adminParticipantId;
    request.deniedAt = Date.now();

    this.pendingRequests.delete(requestId);
    return request;
  }

  /**
   * Gets list of all pending control requests.
   * @returns {Array<object>}
   * @public
   */
  getPendingRequests() {
    return Array.from(this.pendingRequests.values());
  }
}

/**
 * Real-time Cursor Tracking Manager for Participants.
 */
export class CursorTracker {
  static PALETTE = [
    "#FF5733", "#33FF57", "#3357FF", "#F39C12",
    "#9B59B6", "#1ABC9C", "#E74C3C", "#3498DB"
  ];

  constructor() {
    this.cursors = new Map();
  }

  /**
   * Generates a deterministic color hex for a participant ID.
   * @param {string} participantId
   * @returns {string} Hex color string.
   * @public
   */
  generateParticipantColor(participantId) {
    let hash = 0;
    for (let i = 0; i < participantId.length; i++) {
      hash = participantId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % CursorTracker.PALETTE.length;
    return CursorTracker.PALETTE[index];
  }

  /**
   * Sets or updates cursor location for a participant.
   * @param {string} participantId
   * @param {object} cursorData - { row, col, username, selection, color }
   * @returns {object} Updated cursor object.
   * @public
   */
  setCursor(participantId, cursorData = {}) {
    const existing = this.cursors.get(participantId) || {};
    const color = cursorData.color || existing.color || this.generateParticipantColor(participantId);

    const cursor = {
      participantId,
      username: cursorData.username || existing.username || participantId,
      row: typeof cursorData.row === "number" ? cursorData.row : existing.row || 0,
      col: typeof cursorData.col === "number" ? cursorData.col : existing.col || 0,
      selection: cursorData.selection || existing.selection || null,
      color,
      active: cursorData.active !== undefined ? cursorData.active : true,
      lastUpdated: Date.now(),
    };

    this.cursors.set(participantId, cursor);
    return cursor;
  }

  /**
   * Removes cursor state for a participant.
   * @param {string} participantId
   * @public
   */
  removeCursor(participantId) {
    this.cursors.delete(participantId);
  }

  /**
   * Gets cursor state for a participant.
   * @param {string} participantId
   * @returns {object|null}
   * @public
   */
  getCursor(participantId) {
    return this.cursors.get(participantId) || null;
  }

  /**
   * Gets list of all active participant cursors.
   * @returns {Array<object>}
   * @public
   */
  getAllCursors() {
    return Array.from(this.cursors.values());
  }
}

/**
 * Terminal Session Recorder for capturing events with timestamps.
 */
export class SessionRecorder {
  /**
   * Creates a SessionRecorder instance.
   * @param {string|null} sessionId
   * @public
   */
  constructor(sessionId = null) {
    this.sessionId = sessionId;
    this.frames = [];
    this.recording = false;
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Begins recording terminal events.
   * @public
   */
  startRecording() {
    this.frames = [];
    this.recording = true;
    this.startTime = Date.now();
    this.endTime = null;
  }

  /**
   * Stops recording and finalizes time bounds.
   * @returns {object} Summary metadata.
   * @public
   */
  stopRecording() {
    if (!this.recording) return this.getMetadata();
    this.recording = false;
    this.endTime = Date.now();
    return this.getMetadata();
  }

  /**
   * Returns whether recording is currently active.
   * @returns {boolean}
   * @public
   */
  isRecording() {
    return this.recording;
  }

  /**
   * Records a timestamped event frame into the session stream.
   * @param {string} eventType - 'output', 'input', 'resize', 'cursor_move', etc.
   * @param {any} payload - Event payload data.
   * @param {string|null} participantId
   * @public
   */
  recordEvent(eventType, payload, participantId = null) {
    if (!this.recording) return;

    const now = Date.now();
    const frame = {
      timestamp: now,
      relativeTimeMs: now - this.startTime,
      eventType,
      payload,
      participantId,
    };

    this.frames.push(frame);
  }

  /**
   * Returns recorded frame list.
   * @returns {Array<object>}
   * @public
   */
  getFrames() {
    return this.frames;
  }

  /**
   * Exports recorded session in JSON format.
   * @returns {string} JSON string.
   * @public
   */
  exportJSON() {
    const data = {
      version: 1,
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: this.endTime || Date.now(),
      durationMs: (this.endTime || Date.now()) - (this.startTime || Date.now()),
      frameCount: this.frames.length,
      frames: this.frames,
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Exports recorded session in Asciinema v2 header + event format.
   * @returns {string} Asciinema format string.
   * @public
   */
  exportAsciinema() {
    const header = {
      version: 2,
      width: 80,
      height: 24,
      timestamp: Math.floor((this.startTime || Date.now()) / 1000),
      title: `CmdBar Live Session ${this.sessionId || ""}`.trim(),
    };

    const lines = [JSON.stringify(header)];

    for (const frame of this.frames) {
      if (frame.eventType === "output") {
        const timeSec = (frame.relativeTimeMs / 1000).toFixed(6);
        lines.push(JSON.stringify([parseFloat(timeSec), "o", String(frame.payload)]));
      } else if (frame.eventType === "input") {
        const timeSec = (frame.relativeTimeMs / 1000).toFixed(6);
        lines.push(JSON.stringify([parseFloat(timeSec), "i", String(frame.payload)]));
      }
    }

    return lines.join("\n");
  }

  /**
   * Gets recording metadata summary.
   * @returns {object}
   * @public
   */
  getMetadata() {
    const now = Date.now();
    const start = this.startTime || now;
    const end = this.endTime || (this.recording ? now : start);
    return {
      sessionId: this.sessionId,
      recording: this.recording,
      frameCount: this.frames.length,
      startTime: start,
      endTime: end,
      durationMs: end - start,
    };
  }
}

/**
 * Recording Player for Replaying Recorded Terminal Sessions.
 */
export class SessionPlayer {
  /**
   * Creates a SessionPlayer instance.
   * @param {string|object|null} recordingData
   * @public
   */
  constructor(recordingData = null) {
    this.frames = [];
    this.metadata = {};
    this.currentIndex = 0;
    this.playing = false;
    this.speed = 1.0;
    this.timer = null;

    if (recordingData) {
      this.loadRecording(recordingData);
    }
  }

  /**
   * Loads recording data from JSON string, Asciinema string, or JS object.
   * @param {string|object} recordingData
   * @public
   */
  loadRecording(recordingData) {
    this.frames = [];
    this.currentIndex = 0;

    if (typeof recordingData === "string") {
      try {
        const parsed = JSON.parse(recordingData);
        if (parsed.frames && Array.isArray(parsed.frames)) {
          this.frames = parsed.frames;
          this.metadata = parsed;
          return;
        }
      } catch (_) {
        // Try parsing Asciinema v2 format
        const lines = recordingData.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length > 0) {
          try {
            const header = JSON.parse(lines[0]);
            this.metadata = { asciinema: true, header };
            for (let i = 1; i < lines.length; i++) {
              const item = JSON.parse(lines[i]);
              if (Array.isArray(item) && item.length >= 3) {
                const [timeSec, type, data] = item;
                this.frames.push({
                  relativeTimeMs: Math.round(timeSec * 1000),
                  eventType: type === "i" ? "input" : "output",
                  payload: data,
                });
              }
            }
            return;
          } catch (e) {
            throw new Error(`Failed to parse Asciinema recording: ${e.message}`);
          }
        }
      }
    } else if (typeof recordingData === "object" && recordingData !== null) {
      this.frames = recordingData.frames || [];
      this.metadata = recordingData;
      return;
    }

    throw new Error("Invalid recording data format.");
  }

  /**
   * Steps to the next frame and executes callback.
   * @param {function} onFrameCallback
   * @returns {object|null} Executed frame or null if end reached.
   * @public
   */
  stepNext(onFrameCallback) {
    if (this.currentIndex >= this.frames.length) {
      this.playing = false;
      return null;
    }

    const frame = this.frames[this.currentIndex];
    this.currentIndex++;

    if (typeof onFrameCallback === "function") {
      onFrameCallback(frame, this.currentIndex - 1, this.frames.length);
    }

    return frame;
  }

  /**
   * Begins async playback.
   * @param {function} onFrameCallback - Callback invoked for each frame.
   * @param {number} speed - Speed multiplier (e.g., 1.0, 2.0).
   * @public
   */
  play(onFrameCallback, speed = 1.0) {
    this.speed = Math.max(0.1, speed);
    this.playing = true;

    const playLoop = () => {
      if (!this.playing || this.currentIndex >= this.frames.length) {
        this.playing = false;
        return;
      }

      const frame = this.stepNext(onFrameCallback);
      if (!frame) return;

      const nextFrame = this.frames[this.currentIndex];
      let delay = 10;
      if (nextFrame) {
        const delta = nextFrame.relativeTimeMs - frame.relativeTimeMs;
        delay = Math.max(5, Math.min(1000, delta / this.speed));
      }

      if (this.playing) {
        this.timer = setTimeout(playLoop, delay);
      }
    };

    playLoop();
  }

  /**
   * Pauses active playback.
   * @public
   */
  pause() {
    this.playing = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Seeks to a specific frame index or timestamp.
   * @param {number} timestampMs
   * @public
   */
  seek(timestampMs) {
    let index = 0;
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i].relativeTimeMs < timestampMs) {
        index = i + 1;
      } else {
        break;
      }
    }
    this.currentIndex = Math.min(index, this.frames.length);
  }

  /**
   * Gets playback metadata.
   * @returns {object}
   * @public
   */
  getMetadata() {
    const totalFrames = this.frames.length;
    const durationMs = totalFrames > 0 ? this.frames[totalFrames - 1].relativeTimeMs : 0;
    return {
      totalFrames,
      durationMs,
      currentIndex: this.currentIndex,
      playing: this.playing,
      speed: this.speed,
      ...this.metadata,
    };
  }
}

/**
 * WebRTC Signaling and PeerConnection Manager.
 */
export class WebRTCManager {
  static STATES = {
    NEW: "new",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    FAILED: "failed",
    CLOSED: "closed",
  };

  /**
   * Creates a WebRTCManager instance.
   * @param {string} peerId
   * @param {function|null} signalingCallback - Callback to send SDP/ICE signaling messages.
   * @public
   */
  constructor(peerId, signalingCallback = null) {
    this.peerId = peerId;
    this.signalingCallback = signalingCallback;
    this.state = WebRTCManager.STATES.NEW;
    this.encryptor = null;
    this.messageListeners = [];
    this.iceCandidates = [];
    this.remoteOffer = null;
    this.remoteAnswer = null;
  }

  /**
   * Configures E2E encryption for WebRTC message channel.
   * @param {E2EEncryptor} encryptor
   * @public
   */
  setEncryptor(encryptor) {
    this.encryptor = encryptor;
  }

  /**
   * Generates a WebRTC SDP offer.
   * @returns {object} SDP offer object.
   * @public
   */
  createOffer() {
    this.state = WebRTCManager.STATES.CONNECTING;
    const offer = {
      type: "offer",
      peerId: this.peerId,
      sdp: `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=CmdBar-Terminal\r\nt=0 0\r\na=sendrecv\r\n`,
      timestamp: Date.now(),
    };

    if (typeof this.signalingCallback === "function") {
      this.signalingCallback({ type: "sdp_offer", offer, peerId: this.peerId });
    }

    return offer;
  }

  /**
   * Processes incoming WebRTC SDP offer and generates answer.
   * @param {object} offer
   * @returns {object} SDP answer object.
   * @public
   */
  handleOffer(offer) {
    if (!offer || offer.type !== "offer") {
      throw new Error("Invalid SDP offer object.");
    }
    this.remoteOffer = offer;
    this.state = WebRTCManager.STATES.CONNECTING;

    const answer = {
      type: "answer",
      peerId: this.peerId,
      sdp: `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=CmdBar-Terminal-Ans\r\nt=0 0\r\na=sendrecv\r\n`,
      timestamp: Date.now(),
    };

    if (typeof this.signalingCallback === "function") {
      this.signalingCallback({ type: "sdp_answer", answer, peerId: this.peerId });
    }

    this.state = WebRTCManager.STATES.CONNECTED;
    return answer;
  }

  /**
   * Processes incoming WebRTC SDP answer.
   * @param {object} answer
   * @public
   */
  handleAnswer(answer) {
    if (!answer || answer.type !== "answer") {
      throw new Error("Invalid SDP answer object.");
    }
    this.remoteAnswer = answer;
    this.state = WebRTCManager.STATES.CONNECTED;
  }

  /**
   * Adds an ICE candidate to the connection.
   * @param {object} candidate
   * @public
   */
  addIceCandidate(candidate) {
    if (!candidate || !candidate.candidate) {
      throw new Error("Invalid ICE candidate object.");
    }
    this.iceCandidates.push(candidate);
  }

  /**
   * Sends data payload over WebRTC connection (encrypted if encryptor set).
   * @param {any} data
   * @public
   */
  sendMessage(data) {
    if (this.state !== WebRTCManager.STATES.CONNECTED && this.state !== WebRTCManager.STATES.CONNECTING) {
      throw new Error(`Cannot send message. WebRTC state is '${this.state}'.`);
    }

    let payload = data;
    if (this.encryptor && this.encryptor.hasKey()) {
      payload = this.encryptor.encrypt(data);
    }

    if (typeof this.signalingCallback === "function") {
      this.signalingCallback({
        type: "data",
        peerId: this.peerId,
        payload,
      });
    }

    return payload;
  }

  /**
   * Receives and processes an incoming raw WebRTC data message.
   * @param {any} rawMessage
   * @returns {any} Decrypted/parsed message.
   * @public
   */
  receiveMessage(rawMessage) {
    let data = rawMessage;

    if (rawMessage && typeof rawMessage === "object" && rawMessage.encrypted && this.encryptor) {
      data = this.encryptor.decrypt(rawMessage);
    }

    for (const listener of this.messageListeners) {
      try {
        listener(data);
      } catch (e) {
        console.error("Error in WebRTC message listener:", e);
      }
    }

    return data;
  }

  /**
   * Subscribes a listener to incoming WebRTC data messages.
   * @param {function} listener
   * @public
   */
  onMessage(listener) {
    if (typeof listener === "function") {
      this.messageListeners.push(listener);
    }
  }

  /**
   * Returns connection status.
   * @returns {string} Status string.
   * @public
   */
  getStatus() {
    return this.state;
  }

  /**
   * Closes WebRTC connection.
   * @public
   */
  close() {
    this.state = WebRTCManager.STATES.CLOSED;
    this.messageListeners = [];
  }
}

/**
 * Main Collaborative Terminal Session Controller.
 */
export class TerminalSession {
  /**
   * Creates a TerminalSession instance.
   * @param {string} sessionId - Unique session ID.
   * @param {string} hostId - User ID of the session host.
   * @param {string} title - Session title.
   * @param {object} options - Configuration options (rows, cols, secretKey).
   * @public
   */
  constructor(sessionId, hostId, title = "Collaborative Terminal", options = {}) {
    if (!sessionId || !hostId) {
      throw new Error("sessionId and hostId are required.");
    }

    this.sessionId = sessionId;
    this.hostId = hostId;
    this.title = title;
    this.dimensions = {
      rows: options.rows || 24,
      cols: options.cols || 80,
    };

    this.active = true;
    this.createdAt = Date.now();
    this.participants = new Map();
    this.scrollbackHistory = [];
    this.maxScrollback = options.maxScrollback || 1000;

    this.permissionManager = new PermissionManager(hostId, options.defaultRole);
    this.cursorTracker = new CursorTracker();
    this.recorder = new SessionRecorder(sessionId);
    this.encryptor = new E2EEncryptor(options.secretKey || null);

    // Add host as first participant
    this.join({
      id: hostId,
      username: options.hostUsername || hostId,
      role: PermissionManager.ROLES.ADMIN,
    });
  }

  /**
   * Enables E2E encryption key for the session.
   * @param {string} secretKey
   * @public
   */
  setEncryptionKey(secretKey) {
    this.encryptor.setKey(secretKey);
  }

  /**
   * Adds or registers a participant joining the session.
   * @param {object} participant - { id, username, role }
   * @returns {object} Joined participant record.
   * @public
   */
  join(participant) {
    if (!participant || !participant.id) {
      throw new Error("Participant object must contain an 'id' field.");
    }

    const role = participant.role || (participant.id === this.hostId ? PermissionManager.ROLES.ADMIN : PermissionManager.ROLES.READ_ONLY);
    this.permissionManager.setRole(participant.id, role);

    const record = {
      id: participant.id,
      username: participant.username || participant.id,
      role,
      joinedAt: Date.now(),
      status: "connected",
    };

    this.participants.set(participant.id, record);
    this.cursorTracker.setCursor(participant.id, {
      username: record.username,
      row: 0,
      col: 0,
    });

    this.recorder.recordEvent("participant_join", { participantId: participant.id, username: record.username, role }, participant.id);

    return record;
  }

  /**
   * Removes a participant from the session.
   * @param {string} participantId
   * @public
   */
  leave(participantId) {
    if (this.participants.has(participantId)) {
      this.participants.delete(participantId);
      this.cursorTracker.removeCursor(participantId);
      this.recorder.recordEvent("participant_leave", { participantId }, participantId);
    }
  }

  /**
   * Processes terminal input sent by a participant.
   * @param {string} participantId
   * @param {string} inputData
   * @returns {object} Input result payload.
   * @public
   */
  processInput(participantId, inputData) {
    if (!this.active) {
      throw new Error("Session is no longer active.");
    }

    if (!this.permissionManager.hasPermission(participantId, PermissionManager.ACTIONS.WRITE)) {
      throw new Error(`Permission denied: Participant '${participantId}' cannot write input.`);
    }

    this.recorder.recordEvent("input", inputData, participantId);

    return {
      sessionId: this.sessionId,
      participantId,
      data: inputData,
      timestamp: Date.now(),
    };
  }

  /**
   * Broadcasts terminal output from host to participants and buffers history.
   * @param {string} outputData
   * @returns {object} Output broadcast payload.
   * @public
   */
  broadcastOutput(outputData) {
    if (!outputData) return null;

    this.scrollbackHistory.push(outputData);
    if (this.scrollbackHistory.length > this.maxScrollback) {
      this.scrollbackHistory.shift();
    }

    this.recorder.recordEvent("output", outputData, this.hostId);

    return {
      sessionId: this.sessionId,
      data: outputData,
      timestamp: Date.now(),
    };
  }

  /**
   * Updates cursor position for a participant.
   * @param {string} participantId
   * @param {number} row
   * @param {number} col
   * @param {object|null} selection
   * @returns {object} Cursor object.
   * @public
   */
  updateCursor(participantId, row, col, selection = null) {
    if (!this.participants.has(participantId)) {
      throw new Error(`Participant '${participantId}' is not in session.`);
    }

    const cursor = this.cursorTracker.setCursor(participantId, { row, col, selection });
    this.recorder.recordEvent("cursor_move", { row, col, selection }, participantId);
    return cursor;
  }

  /**
   * Resizes terminal dimensions.
   * @param {string} participantId
   * @param {number} rows
   * @param {number} cols
   * @returns {object} Updated dimensions.
   * @public
   */
  resizeTerminal(participantId, rows, cols) {
    if (!this.permissionManager.hasPermission(participantId, PermissionManager.ACTIONS.RESIZE)) {
      throw new Error(`Permission denied: Participant '${participantId}' cannot resize terminal.`);
    }

    this.dimensions = { rows, cols };
    this.recorder.recordEvent("resize", { rows, cols }, participantId);
    return this.dimensions;
  }

  /**
   * Gets terminal scrollback history buffer.
   * @returns {Array<string>}
   * @public
   */
  getScrollbackHistory() {
    return [...this.scrollbackHistory];
  }

  /**
   * Begins session recording.
   * @public
   */
  startRecording() {
    this.recorder.startRecording();
  }

  /**
   * Stops session recording and returns metadata.
   * @returns {object} Recording metadata.
   * @public
   */
  stopRecording() {
    return this.recorder.stopRecording();
  }

  /**
   * Returns complete serializable snapshot of current session state.
   * @returns {object}
   * @public
   */
  getSessionState() {
    return {
      sessionId: this.sessionId,
      hostId: this.hostId,
      title: this.title,
      active: this.active,
      dimensions: this.dimensions,
      createdAt: this.createdAt,
      encrypted: this.encryptor.hasKey(),
      recording: this.recorder.isRecording(),
      participants: Array.from(this.participants.values()),
      cursors: this.cursorTracker.getAllCursors(),
      pendingRequests: this.permissionManager.getPendingRequests(),
    };
  }
}
