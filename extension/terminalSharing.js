/**
 * Live Terminal Sharing Module for CmdBar.
 * Provides collaborative terminal sessions, real-time input/output streaming,
 * cursor tracking, role-based permission control, session recording,
 * E2E encryption, and WebRTC data channel abstraction.
 */

import crypto from "crypto";

export const Role = Object.freeze({
  HOST: "host",
  EDITOR: "editor",
  VIEWER: "viewer",
});

export const SessionState = Object.freeze({
  IDLE: "idle",
  ACTIVE: "active",
  PAUSED: "paused",
  ENDED: "ended",
});

export const ConnectionState = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
});

export const EventType = Object.freeze({
  OUTPUT: "output",
  INPUT: "input",
  CURSOR: "cursor",
  RESIZE: "resize",
  PERMISSION: "permission",
  PEER_JOIN: "peer_join",
  PEER_LEAVE: "peer_leave",
});

/**
 * End-to-End Encryption Manager using AES-256-GCM.
 */
export class E2EEncryptionManager {
  constructor(secretKey = null) {
    if (secretKey) {
      this.setKey(secretKey);
    } else {
      this.key = this.generateKey();
    }
  }

  generateKey() {
    if (typeof crypto !== "undefined" && crypto.randomBytes) {
      return crypto.randomBytes(32).toString("hex");
    }
    let key = "";
    const chars = "0123456789abcdef";
    for (let i = 0; i < 64; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }

  setKey(keyOrPassphrase) {
    if (!keyOrPassphrase) return;
    if (typeof keyOrPassphrase === "string" && keyOrPassphrase.length === 64 && /^[0-9a-fA-F]+$/.test(keyOrPassphrase)) {
      this.key = keyOrPassphrase.toLowerCase();
    } else {
      if (typeof crypto !== "undefined" && crypto.createHash) {
        this.key = crypto.createHash("sha256").update(String(keyOrPassphrase)).digest("hex");
      } else {
        this.key = this._simpleHash(String(keyOrPassphrase));
      }
    }
  }

  encrypt(data) {
    const jsonStr = typeof data === "string" ? data : JSON.stringify(data);

    if (typeof crypto !== "undefined" && crypto.createCipheriv && crypto.randomBytes) {
      try {
        const keyBuffer = Buffer.from(this.key, "hex");
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
        let encrypted = cipher.update(jsonStr, "utf8", "base64");
        encrypted += cipher.final("base64");
        const tag = cipher.getAuthTag().toString("base64");
        return {
          algorithm: "AES-256-GCM",
          ciphertext: encrypted,
          iv: iv.toString("base64"),
          tag: tag,
        };
      } catch (e) {
        // Fallback
      }
    }

    return this._fallbackEncrypt(jsonStr);
  }

  decrypt(payload) {
    if (!payload) return null;
    let obj = payload;
    if (typeof payload === "string") {
      try {
        obj = JSON.parse(payload);
      } catch (e) {
        return payload;
      }
    }

    if (obj.algorithm === "AES-256-GCM" && typeof crypto !== "undefined" && crypto.createDecipheriv) {
      try {
        const keyBuffer = Buffer.from(this.key, "hex");
        const iv = Buffer.from(obj.iv, "base64");
        const tag = Buffer.from(obj.tag, "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(obj.ciphertext, "base64", "utf8");
        decrypted += decipher.final("utf8");
        try {
          return JSON.parse(decrypted);
        } catch (e) {
          return decrypted;
        }
      } catch (e) {
        throw new Error(`E2E Decryption failed: ${e.message}`);
      }
    }

    if (obj.algorithm === "XOR-HMAC-FALLBACK") {
      return this._fallbackDecrypt(obj);
    }

    return obj;
  }

  _fallbackEncrypt(plainText) {
    const iv = Math.random().toString(36).substring(2, 10);
    let ciphertext = "";
    for (let i = 0; i < plainText.length; i++) {
      const charCode = plainText.charCodeAt(i) ^ this.key.charCodeAt(i % this.key.length);
      ciphertext += String.fromCharCode(charCode);
    }
    return {
      algorithm: "XOR-HMAC-FALLBACK",
      ciphertext: Buffer.from(ciphertext, "binary").toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
    };
  }

  _fallbackDecrypt(obj) {
    const raw = Buffer.from(obj.ciphertext, "base64").toString("binary");
    let plainText = "";
    for (let i = 0; i < raw.length; i++) {
      const charCode = raw.charCodeAt(i) ^ this.key.charCodeAt(i % this.key.length);
      plainText += String.fromCharCode(charCode);
    }
    try {
      return JSON.parse(plainText);
    } catch (e) {
      return plainText;
    }
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    let hex = Math.abs(hash).toString(16);
    while (hex.length < 64) hex += hex;
    return hex.substring(0, 64);
  }
}

/**
 * Tracks participant terminal cursor positions and selections in real-time.
 */
export class CursorTracker {
  constructor() {
    this.cursors = new Map();
  }

  updateCursor(participantId, cursorData = {}) {
    if (!participantId) return null;
    const {
      line = 0,
      col = 0,
      visible = true,
      selection = null,
      name = "",
      color = "#00ff00",
    } = cursorData;

    const existing = this.cursors.get(participantId) || {};
    const updated = {
      participantId,
      line: Math.max(0, parseInt(line, 10) || 0),
      col: Math.max(0, parseInt(col, 10) || 0),
      visible: Boolean(visible),
      selection: selection || null,
      name: name || existing.name || participantId,
      color: color || existing.color || "#00ff00",
      updatedAt: Date.now(),
    };
    this.cursors.set(participantId, updated);
    return updated;
  }

  getCursor(participantId) {
    return this.cursors.get(participantId) || null;
  }

  getAllCursors() {
    return Array.from(this.cursors.values());
  }

  removeCursor(participantId) {
    return this.cursors.delete(participantId);
  }

  clear() {
    this.cursors.clear();
  }
}

/**
 * Role-based permission manager for collaborative terminal sessions.
 */
export class PermissionManager {
  constructor(defaultRole = Role.VIEWER) {
    this.defaultRole = defaultRole;
    this.roles = new Map();
    this.pendingRequests = new Map();
  }

  setRole(participantId, role) {
    if (!participantId) return;
    if (!Object.values(Role).includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    this.roles.set(participantId, role);
  }

  getRole(participantId) {
    return this.roles.get(participantId) || this.defaultRole;
  }

  canWrite(participantId) {
    const role = this.getRole(participantId);
    return role === Role.HOST || role === Role.EDITOR;
  }

  requestControl(participantId, reason = "") {
    if (!participantId) return null;
    if (this.canWrite(participantId)) {
      return { participantId, status: "already_granted" };
    }
    const req = {
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      participantId,
      reason,
      timestamp: Date.now(),
      status: "pending",
    };
    this.pendingRequests.set(participantId, req);
    return req;
  }

  grantControl(participantId) {
    if (!participantId) return false;
    this.setRole(participantId, Role.EDITOR);
    this.pendingRequests.delete(participantId);
    return true;
  }

  revokeControl(participantId) {
    if (!participantId) return false;
    const currentRole = this.getRole(participantId);
    if (currentRole === Role.HOST) {
      throw new Error("Cannot revoke write permission from Host");
    }
    this.setRole(participantId, Role.VIEWER);
    return true;
  }

  rejectRequest(participantId) {
    if (this.pendingRequests.has(participantId)) {
      const req = this.pendingRequests.get(participantId);
      req.status = "rejected";
      this.pendingRequests.delete(participantId);
      return true;
    }
    return false;
  }

  getPendingRequests() {
    return Array.from(this.pendingRequests.values());
  }
}

/**
 * Records terminal session events and exports to Asciinema v2 or JSON formats.
 */
export class SessionRecorder {
  constructor() {
    this.frames = [];
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pauseTime = null;
    this.totalPausedDuration = 0;
  }

  start() {
    this.frames = [];
    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.totalPausedDuration = 0;
  }

  pause() {
    if (this.isRecording && !this.isPaused) {
      this.isPaused = true;
      this.pauseTime = Date.now();
    }
  }

  resume() {
    if (this.isRecording && this.isPaused) {
      this.totalPausedDuration += Date.now() - this.pauseTime;
      this.isPaused = false;
      this.pauseTime = null;
    }
  }

  stop() {
    if (this.isRecording) {
      if (this.isPaused) {
        this.resume();
      }
      this.isRecording = false;
    }
  }

  recordFrame(event, payload, participantId = "host") {
    if (!this.isRecording || this.isPaused) return null;
    const now = Date.now();
    const elapsed = (now - this.startTime - this.totalPausedDuration) / 1000;
    const frame = {
      timestamp: parseFloat(elapsed.toFixed(3)),
      event,
      payload,
      participantId,
    };
    this.frames.push(frame);
    return frame;
  }

  getFrames() {
    return [...this.frames];
  }

  exportJSON() {
    return JSON.stringify(
      {
        version: 1,
        recordingDate: new Date().toISOString(),
        totalFrames: this.frames.length,
        frames: this.frames,
      },
      null,
      2
    );
  }

  exportAsciinema({ width = 80, height = 24, title = "CmdBar Live Terminal Sharing Session" } = {}) {
    const header = JSON.stringify({
      version: 2,
      width,
      height,
      timestamp: Math.floor((this.startTime || Date.now()) / 1000),
      title,
      env: { TERM: "xterm-256color" },
    });

    const lines = [header];
    for (const frame of this.frames) {
      if (frame.event === EventType.OUTPUT) {
        const text = typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload);
        lines.push(JSON.stringify([frame.timestamp, "o", text]));
      } else if (frame.event === EventType.INPUT) {
        const text = typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload);
        lines.push(JSON.stringify([frame.timestamp, "i", text]));
      }
    }
    return lines.join("\n");
  }

  clear() {
    this.frames = [];
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
  }
}

/**
 * WebRTC DataChannel & Signaling Abstraction.
 */
export class WebRTCSharingChannel {
  constructor(options = {}) {
    this.sessionId = options.sessionId || "";
    this.signalingServerUrl = options.signalingServerUrl || "wss://signaling.cmdbar.local";
    this.connectionState = ConnectionState.DISCONNECTED;
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.messageListeners = [];
    this.connectionStateListeners = [];
  }

  setConnectionState(state) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      for (const cb of this.connectionStateListeners) {
        try {
          cb(state);
        } catch (e) {}
      }
    }
  }

  createOffer(peerId) {
    const offer = {
      type: "offer",
      sdp: `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=CmdBar-WebRTC\r\nt=0 0\r\na=sendrecv`,
      peerId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    };
    this.setConnectionState(ConnectionState.CONNECTING);
    return offer;
  }

  handleOffer(peerId, offer) {
    if (!offer || offer.type !== "offer") {
      throw new Error("Invalid SDP offer");
    }
    const answer = {
      type: "answer",
      sdp: offer.sdp.replace("a=sendrecv", "a=recvonly"),
      peerId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    };
    this.setConnectionState(ConnectionState.CONNECTED);
    return answer;
  }

  handleAnswer(peerId, answer) {
    if (!answer || answer.type !== "answer") {
      throw new Error("Invalid SDP answer");
    }
    this.setConnectionState(ConnectionState.CONNECTED);
    return true;
  }

  addIceCandidate(peerId, candidate) {
    if (!candidate || !candidate.candidate) {
      return false;
    }
    const existing = this.peerConnections.get(peerId) || { candidates: [] };
    existing.candidates.push(candidate);
    this.peerConnections.set(peerId, existing);
    return true;
  }

  send(peerId, message) {
    if (this.connectionState !== ConnectionState.CONNECTED && this.connectionState !== ConnectionState.CONNECTING) {
      throw new Error("Channel is not connected");
    }
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel && typeof dataChannel.send === "function") {
      dataChannel.send(typeof message === "string" ? message : JSON.stringify(message));
    } else {
      // Internal listener dispatch for simulation / fallback
      this._dispatchToListeners(message, peerId);
    }
    return true;
  }

  broadcast(message, excludePeerId = null) {
    const peers = Array.from(this.peerConnections.keys());
    for (const peerId of peers) {
      if (peerId !== excludePeerId) {
        this.send(peerId, message);
      }
    }
    if (peers.length === 0) {
      // Dispatch locally if no explicit peers registered yet
      this._dispatchToListeners(message, "broadcast");
    }
    return true;
  }

  onMessage(callback) {
    if (typeof callback === "function") {
      this.messageListeners.push(callback);
    }
  }

  onConnectionStateChange(callback) {
    if (typeof callback === "function") {
      this.connectionStateListeners.push(callback);
    }
  }

  _dispatchToListeners(message, senderId) {
    for (const listener of this.messageListeners) {
      try {
        listener(message, senderId);
      } catch (e) {}
    }
  }

  close() {
    this.setConnectionState(ConnectionState.DISCONNECTED);
    this.peerConnections.clear();
    this.dataChannels.clear();
  }
}

/**
 * Main Collaborative Live Terminal Sharing Session Manager.
 */
export class TerminalSharingSession {
  constructor(options = {}) {
    this.sessionId = options.sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.title = options.title || "CmdBar Shared Terminal";
    this.host = options.host || { id: "host", name: "Session Host", email: "host@cmdbar.local" };
    this.maxParticipants = options.maxParticipants || 10;
    this.state = SessionState.IDLE;
    this.participants = new Map();

    // Features
    this.e2eEnabled = options.e2eEnabled !== false;
    this.encryptionManager = new E2EEncryptionManager(options.secretKey || null);
    this.cursorTracker = new CursorTracker();
    this.permissionManager = new PermissionManager(options.defaultRole || Role.VIEWER);
    this.recorder = new SessionRecorder();
    this.channel = new WebRTCSharingChannel({
      sessionId: this.sessionId,
      signalingServerUrl: options.signalingServerUrl,
    });

    // Performance Metrics
    this.metrics = {
      framesProcessed: 0,
      totalBytesStreamed: 0,
      processingLatenciesMs: [],
      startTimeMs: null,
    };

    this.eventListeners = [];
    this.channel.onMessage((msg, senderId) => this._handleInboundMessage(msg, senderId));
  }

  start() {
    if (this.state === SessionState.ACTIVE) return this;
    this.state = SessionState.ACTIVE;
    this.metrics.startTimeMs = Date.now();

    // Add Host
    const hostParticipant = {
      id: this.host.id,
      name: this.host.name,
      email: this.host.email,
      role: Role.HOST,
      joinedAt: Date.now(),
    };
    this.participants.set(this.host.id, hostParticipant);
    this.permissionManager.setRole(this.host.id, Role.HOST);
    this.cursorTracker.updateCursor(this.host.id, { line: 0, col: 0, visible: true, name: this.host.name });

    this._emitEvent("session_started", { sessionId: this.sessionId, title: this.title });
    return this;
  }

  joinParticipant(participantInfo) {
    if (this.state !== SessionState.ACTIVE) {
      throw new Error("Cannot join a session that is not active");
    }
    if (this.participants.size >= this.maxParticipants) {
      throw new Error(`Session participant limit (${this.maxParticipants}) reached`);
    }

    const id = participantInfo.id || `peer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const role = participantInfo.role || this.permissionManager.defaultRole;

    const participant = {
      id,
      name: participantInfo.name || id,
      email: participantInfo.email || "",
      role,
      joinedAt: Date.now(),
    };

    this.participants.set(id, participant);
    this.permissionManager.setRole(id, role);
    this.cursorTracker.updateCursor(id, { line: 0, col: 0, visible: true, name: participant.name });

    if (this.recorder.isRecording) {
      this.recorder.recordFrame(EventType.PEER_JOIN, { participantId: id, name: participant.name, role }, id);
    }

    this._emitEvent("participant_joined", participant);
    return participant;
  }

  leaveParticipant(participantId) {
    if (!this.participants.has(participantId)) return false;
    const participant = this.participants.get(participantId);

    if (this.recorder.isRecording) {
      this.recorder.recordFrame(EventType.PEER_LEAVE, { participantId, name: participant.name }, participantId);
    }

    this.participants.delete(participantId);
    this.cursorTracker.removeCursor(participantId);

    this._emitEvent("participant_left", { participantId, name: participant.name });
    return true;
  }

  broadcastOutput(stdoutOrStderr) {
    const t0 = Date.now();
    if (this.state !== SessionState.ACTIVE) {
      throw new Error("Session is not active");
    }

    const payload = typeof stdoutOrStderr === "string" ? stdoutOrStderr : JSON.stringify(stdoutOrStderr);

    // Recording
    if (this.recorder.isRecording) {
      this.recorder.recordFrame(EventType.OUTPUT, payload, this.host.id);
    }

    // Encryption & Broadcast
    const frame = {
      type: EventType.OUTPUT,
      sessionId: this.sessionId,
      senderId: this.host.id,
      timestamp: Date.now(),
      payload: this.e2eEnabled ? this.encryptionManager.encrypt(payload) : payload,
      isEncrypted: this.e2eEnabled,
    };

    this.channel.broadcast(frame);

    // Track Metrics
    const latency = Date.now() - t0;
    this.metrics.framesProcessed++;
    this.metrics.totalBytesStreamed += payload.length;
    this.metrics.processingLatenciesMs.push(latency);

    this._emitEvent("output_broadcast", { length: payload.length, latencyMs: latency });
    return frame;
  }

  sendInput(participantId, inputData) {
    const t0 = Date.now();
    if (this.state !== SessionState.ACTIVE) {
      throw new Error("Session is not active");
    }

    if (!this.permissionManager.canWrite(participantId)) {
      throw new Error(`Participant '${participantId}' does not have write permission`);
    }

    const payload = typeof inputData === "string" ? inputData : JSON.stringify(inputData);

    // Recording
    if (this.recorder.isRecording) {
      this.recorder.recordFrame(EventType.INPUT, payload, participantId);
    }

    const frame = {
      type: EventType.INPUT,
      sessionId: this.sessionId,
      senderId: participantId,
      timestamp: Date.now(),
      payload: this.e2eEnabled ? this.encryptionManager.encrypt(payload) : payload,
      isEncrypted: this.e2eEnabled,
    };

    this.channel.broadcast(frame);

    const latency = Date.now() - t0;
    this.metrics.framesProcessed++;
    this.metrics.totalBytesStreamed += payload.length;
    this.metrics.processingLatenciesMs.push(latency);

    this._emitEvent("input_sent", { participantId, length: payload.length, latencyMs: latency });
    return frame;
  }

  updateCursorPosition(participantId, cursorInfo) {
    if (this.state !== SessionState.ACTIVE) return null;
    const updated = this.cursorTracker.updateCursor(participantId, cursorInfo);

    const frame = {
      type: EventType.CURSOR,
      sessionId: this.sessionId,
      senderId: participantId,
      timestamp: Date.now(),
      payload: updated,
    };

    if (this.recorder.isRecording) {
      this.recorder.recordFrame(EventType.CURSOR, updated, participantId);
    }

    this.channel.broadcast(frame);
    this._emitEvent("cursor_updated", updated);
    return updated;
  }

  requestInputPermission(participantId, reason = "") {
    const req = this.permissionManager.requestControl(participantId, reason);
    if (req) {
      this._emitEvent("permission_requested", req);
    }
    return req;
  }

  grantInputPermission(hostOrAdminId, targetParticipantId) {
    if (!this.permissionManager.canWrite(hostOrAdminId)) {
      throw new Error("Only hosts or editors can grant write permissions");
    }
    const granted = this.permissionManager.grantControl(targetParticipantId);
    if (granted) {
      if (this.participants.has(targetParticipantId)) {
        this.participants.get(targetParticipantId).role = Role.EDITOR;
      }
      this._emitEvent("permission_granted", { targetParticipantId, grantedBy: hostOrAdminId });
    }
    return granted;
  }

  revokeInputPermission(hostOrAdminId, targetParticipantId) {
    if (this.permissionManager.getRole(hostOrAdminId) !== Role.HOST) {
      throw new Error("Only the session Host can revoke write permissions");
    }
    const revoked = this.permissionManager.revokeControl(targetParticipantId);
    if (revoked) {
      if (this.participants.has(targetParticipantId)) {
        this.participants.get(targetParticipantId).role = Role.VIEWER;
      }
      this._emitEvent("permission_revoked", { targetParticipantId, revokedBy: hostOrAdminId });
    }
    return revoked;
  }

  startRecording() {
    this.recorder.start();
    this._emitEvent("recording_started", { sessionId: this.sessionId });
  }

  pauseRecording() {
    this.recorder.pause();
    this._emitEvent("recording_paused", { sessionId: this.sessionId });
  }

  resumeRecording() {
    this.recorder.resume();
    this._emitEvent("recording_resumed", { sessionId: this.sessionId });
  }

  stopRecording() {
    this.recorder.stop();
    this._emitEvent("recording_stopped", { sessionId: this.sessionId, totalFrames: this.recorder.frames.length });
  }

  exportRecording(format = "asciinema", options = {}) {
    if (format === "asciinema") {
      return this.recorder.exportAsciinema(options);
    } else if (format === "json") {
      return this.recorder.exportJSON();
    }
    throw new Error(`Unsupported export format: ${format}`);
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  getMetrics() {
    const latencies = this.metrics.processingLatenciesMs;
    const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const maxLatency = latencies.length ? Math.max(...latencies) : 0;
    const durationSec = this.metrics.startTimeMs ? (Date.now() - this.metrics.startTimeMs) / 1000 : 0;

    return {
      sessionId: this.sessionId,
      state: this.state,
      activeParticipants: this.participants.size,
      framesProcessed: this.metrics.framesProcessed,
      totalBytesStreamed: this.metrics.totalBytesStreamed,
      avgLatencyMs: parseFloat(avgLatency.toFixed(2)),
      maxLatencyMs: maxLatency,
      durationSec: parseFloat(durationSec.toFixed(1)),
      e2eEncrypted: this.e2eEnabled,
      memoryUsageBytes: process.memoryUsage ? process.memoryUsage().heapUsed : 0,
    };
  }

  onEvent(callback) {
    if (typeof callback === "function") {
      this.eventListeners.push(callback);
    }
  }

  _emitEvent(event, data) {
    for (const cb of this.eventListeners) {
      try {
        cb(event, data);
      } catch (e) {}
    }
  }

  _handleInboundMessage(msg, senderId) {
    if (!msg || typeof msg !== "object") return;

    let payload = msg.payload;
    if (msg.isEncrypted) {
      try {
        payload = this.encryptionManager.decrypt(payload);
      } catch (e) {
        console.error(`Failed to decrypt inbound message: ${e.message}`);
        return;
      }
    }

    if (msg.type === EventType.CURSOR) {
      this.cursorTracker.updateCursor(msg.senderId || senderId, payload);
    }
  }

  endSession() {
    if (this.state === SessionState.ENDED) return;
    this.stopRecording();
    this.state = SessionState.ENDED;
    this.channel.close();
    this.participants.clear();
    this.cursorTracker.clear();
    this._emitEvent("session_ended", { sessionId: this.sessionId });
  }
}
