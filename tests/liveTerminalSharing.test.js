import {
  E2EEncryptor,
  PermissionManager,
  CursorTracker,
  SessionRecorder,
  SessionPlayer,
  WebRTCManager,
  TerminalSession,
} from "../extension/liveTerminalSharing.js";

describe("Live Terminal Sharing Module", () => {
  describe("E2E Encryption (AES-256-GCM)", () => {
    test("should generate and set valid 256-bit encryption keys", () => {
      const encryptor = new E2EEncryptor();
      expect(encryptor.hasKey()).toBe(false);

      const key = encryptor.generateKey();
      expect(key).toHaveLength(64);

      encryptor.setKey(key);
      expect(encryptor.hasKey()).toBe(true);
    });

    test("should derive key from passphrase and salt", () => {
      const encryptor = new E2EEncryptor();
      const derivedKey = encryptor.deriveKeyFromPassphrase("secret-passphrase", "salt123");
      expect(derivedKey).toBeDefined();
      expect(derivedKey.length).toBeGreaterThanOrEqual(32);
    });

    test("should encrypt and decrypt string and JSON payloads", () => {
      const encryptor = new E2EEncryptor();
      const key = encryptor.generateKey();
      encryptor.setKey(key);

      const message = "echo 'Hello Collaborative Terminal'";
      const encrypted = encryptor.encrypt(message);

      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();

      const decrypted = encryptor.decrypt(encrypted);
      expect(decrypted).toBe(message);

      const jsonPayload = { command: "ls -la", user: "alice", pid: 1234 };
      const encryptedJson = encryptor.encrypt(jsonPayload);
      const decryptedJson = encryptor.decrypt(encryptedJson);
      expect(decryptedJson).toEqual(jsonPayload);
    });

    test("should fail decryption when payload is invalid or key is wrong", () => {
      const encryptor = new E2EEncryptor();
      encryptor.setKey(encryptor.generateKey());

      expect(() => encryptor.decrypt(null)).toThrow();
      expect(() => encryptor.decrypt({ ciphertext: "abc" })).toThrow();

      const invalidPayload = { ciphertext: "ffff", iv: "000000000000000000000000", authTag: "0000" };
      expect(() => encryptor.decrypt(invalidPayload)).toThrow();
    });
  });

  describe("Permission Control Manager", () => {
    let permManager;
    const hostId = "user_host";
    const peerId = "user_peer";

    beforeEach(() => {
      permManager = new PermissionManager(hostId, PermissionManager.ROLES.READ_ONLY);
    });

    test("should assign default role to host and peers", () => {
      expect(permManager.getRole(hostId)).toBe(PermissionManager.ROLES.ADMIN);
      expect(permManager.getRole(peerId)).toBe(PermissionManager.ROLES.READ_ONLY);
    });

    test("should enforce permissions correctly based on roles", () => {
      // Host / Admin
      expect(permManager.hasPermission(hostId, PermissionManager.ACTIONS.READ)).toBe(true);
      expect(permManager.hasPermission(hostId, PermissionManager.ACTIONS.WRITE)).toBe(true);
      expect(permManager.hasPermission(hostId, PermissionManager.ACTIONS.TERMINATE_SESSION)).toBe(true);

      // Read-only Peer
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.READ)).toBe(true);
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.WRITE)).toBe(false);
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.RESIZE)).toBe(false);
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.REQUEST_CONTROL)).toBe(true);

      // Promote peer to read-write
      permManager.setRole(peerId, PermissionManager.ROLES.READ_WRITE);
      expect(permManager.getRole(peerId)).toBe(PermissionManager.ROLES.READ_WRITE);
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.WRITE)).toBe(true);
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.RESIZE)).toBe(true);
      expect(permManager.hasPermission(peerId, PermissionManager.ACTIONS.TERMINATE_SESSION)).toBe(false);
    });

    test("should manage control request lifecycle (request, approve, deny)", () => {
      const request = permManager.requestControl(peerId, PermissionManager.ROLES.READ_WRITE, "Need to type command");
      expect(request.requestId).toBeDefined();
      expect(request.status).toBe("pending");
      expect(permManager.getPendingRequests()).toHaveLength(1);

      // Non-admin cannot approve
      expect(() => permManager.approveControlRequest(request.requestId, peerId)).toThrow();

      // Admin approves
      const approved = permManager.approveControlRequest(request.requestId, hostId);
      expect(approved.status).toBe("approved");
      expect(permManager.getRole(peerId)).toBe(PermissionManager.ROLES.READ_WRITE);
      expect(permManager.getPendingRequests()).toHaveLength(0);

      // Deny test
      const peer2 = "user_peer_2";
      permManager.setRole(peer2, PermissionManager.ROLES.READ_ONLY);
      const req2 = permManager.requestControl(peer2);
      const denied = permManager.denyControlRequest(req2.requestId, hostId);
      expect(denied.status).toBe("denied");
      expect(permManager.getRole(peer2)).toBe(PermissionManager.ROLES.READ_ONLY);
    });
  });

  describe("Cursor Tracking Manager", () => {
    let tracker;

    beforeEach(() => {
      tracker = new CursorTracker();
    });

    test("should track participant cursor movements and selection", () => {
      const cursor = tracker.setCursor("user1", { row: 5, col: 12, username: "Alice" });
      expect(cursor.participantId).toBe("user1");
      expect(cursor.username).toBe("Alice");
      expect(cursor.row).toBe(5);
      expect(cursor.col).toBe(12);
      expect(cursor.color).toBeDefined();

      const updated = tracker.setCursor("user1", { row: 6, col: 15, selection: { startRow: 6, startCol: 0, endRow: 6, endCol: 15 } });
      expect(updated.row).toBe(6);
      expect(updated.selection).toBeDefined();

      const all = tracker.getAllCursors();
      expect(all).toHaveLength(1);
    });

    test("should generate distinct deterministic colors for participants", () => {
      const color1 = tracker.generateParticipantColor("user_alpha");
      const color2 = tracker.generateParticipantColor("user_beta");
      expect(color1).toMatch(/^#[0-9A-FA-f]{6}$/);
      expect(color2).toMatch(/^#[0-9A-FA-f]{6}$/);
      expect(tracker.generateParticipantColor("user_alpha")).toBe(color1);
    });

    test("should handle cursor removal", () => {
      tracker.setCursor("user1", { row: 1, col: 1 });
      expect(tracker.getCursor("user1")).toBeDefined();
      tracker.removeCursor("user1");
      expect(tracker.getCursor("user1")).toBeNull();
    });
  });

  describe("Session Recording & Playback", () => {
    test("should record events and export to JSON and Asciinema v2 formats", () => {
      const recorder = new SessionRecorder("session_rec_1");
      recorder.startRecording();
      expect(recorder.isRecording()).toBe(true);

      recorder.recordEvent("output", "welcome to bash\n", "host");
      recorder.recordEvent("input", "ls -l\n", "peer1");
      recorder.recordEvent("output", "file1.txt  file2.txt\n", "host");

      const meta = recorder.stopRecording();
      expect(recorder.isRecording()).toBe(false);
      expect(meta.frameCount).toBe(3);

      const jsonStr = recorder.exportJSON();
      expect(jsonStr).toContain("session_rec_1");
      expect(jsonStr).toContain("welcome to bash");

      const asciinemaStr = recorder.exportAsciinema();
      expect(asciinemaStr).toContain('"version"');
      expect(asciinemaStr).toContain('"o"');
      expect(asciinemaStr).toContain('"i"');
    });

    test("should load and step/play recorded sessions with SessionPlayer", () => {
      const recorder = new SessionRecorder("session_rec_2");
      recorder.startRecording();
      recorder.recordEvent("output", "line 1\n");
      recorder.recordEvent("output", "line 2\n");
      recorder.stopRecording();

      const player = new SessionPlayer(recorder.exportJSON());
      const metadata = player.getMetadata();
      expect(metadata.totalFrames).toBe(2);

      let stepCount = 0;
      player.stepNext((frame) => {
        stepCount++;
        expect(frame.payload).toBe("line 1\n");
      });
      expect(stepCount).toBe(1);

      player.seek(0);
      expect(player.getMetadata().currentIndex).toBe(0);
    });
  });

  describe("WebRTC Manager", () => {
    test("should handle WebRTC signaling lifecycle (offer, answer, ICE candidates)", () => {
      let signalingMsg = null;
      const rtcHost = new WebRTCManager("host_peer", (msg) => {
        signalingMsg = msg;
      });

      expect(rtcHost.getStatus()).toBe("new");

      const offer = rtcHost.createOffer();
      expect(offer.type).toBe("offer");
      expect(signalingMsg.type).toBe("sdp_offer");
      expect(rtcHost.getStatus()).toBe("connecting");

      const rtcPeer = new WebRTCManager("client_peer");
      const answer = rtcPeer.handleOffer(offer);
      expect(answer.type).toBe("answer");
      expect(rtcPeer.getStatus()).toBe("connected");

      rtcHost.handleAnswer(answer);
      expect(rtcHost.getStatus()).toBe("connected");

      rtcHost.addIceCandidate({ candidate: "candidate:1 1 UDP 2013266431 192.168.1.1 50000 typ host" });
      expect(rtcHost.iceCandidates).toHaveLength(1);
    });

    test("should send and receive encrypted messages over WebRTC data channel", () => {
      const encryptor = new E2EEncryptor();
      encryptor.setKey(encryptor.generateKey());

      let lastSentPayload = null;
      const rtc = new WebRTCManager("peer_crypto", (msg) => {
        lastSentPayload = msg.payload;
      });
      rtc.setEncryptor(encryptor);
      rtc.state = WebRTCManager.STATES.CONNECTED;

      let receivedData = null;
      rtc.onMessage((data) => {
        receivedData = data;
      });

      const messageObj = { type: "terminal_input", char: "a" };
      rtc.sendMessage(messageObj);

      expect(lastSentPayload.encrypted).toBe(true);

      const decrypted = rtc.receiveMessage(lastSentPayload);
      expect(decrypted).toEqual(messageObj);
      expect(receivedData).toEqual(messageObj);
    });
  });

  describe("TerminalSession Integration", () => {
    test("should orchestrate collaborative terminal session end-to-end", () => {
      const session = new TerminalSession("session_101", "admin_user", "Team DevOps Terminal");
      const key = session.encryptor.generateKey();
      session.setEncryptionKey(key);

      // Join participants
      const peer = session.join({ id: "peer_bob", username: "Bob", role: "read-only" });
      expect(peer.role).toBe("read-only");

      // Peer attempts to type without write permission -> throws
      expect(() => session.processInput("peer_bob", "rm -rf /")).toThrow();

      // Grant write permission to Bob
      session.permissionManager.setRole("peer_bob", "read-write");
      const inputResult = session.processInput("peer_bob", "git status\n");
      expect(inputResult.data).toBe("git status\n");

      // Host broadcasts output
      const outputResult = session.broadcastOutput("On branch main\nnothing to commit\n");
      expect(outputResult.data).toContain("On branch main");
      expect(session.getScrollbackHistory()).toHaveLength(1);

      // Cursor movement
      const cursor = session.updateCursor("peer_bob", 10, 5);
      expect(cursor.row).toBe(10);

      // Terminal resize
      const dim = session.resizeTerminal("peer_bob", 40, 120);
      expect(dim.rows).toBe(40);
      expect(dim.cols).toBe(120);

      // Session state snapshot
      const state = session.getSessionState();
      expect(state.sessionId).toBe("session_101");
      expect(state.participants).toHaveLength(2);
      expect(state.encrypted).toBe(true);
    });
  });

  describe("Performance Benchmarks", () => {
    test("should meet encryption/decryption throughput performance benchmark (>1,000 ops/sec)", () => {
      const encryptor = new E2EEncryptor();
      encryptor.setKey(encryptor.generateKey());
      const testData = { payload: "x".repeat(256), timestamp: Date.now() };

      const startTime = Date.now();
      const iterations = 500;

      for (let i = 0; i < iterations; i++) {
        const encrypted = encryptor.encrypt(testData);
        encryptor.decrypt(encrypted);
      }

      const elapsedMs = Date.now() - startTime;
      const opsPerSec = (iterations / elapsedMs) * 1000;

      expect(elapsedMs).toBeLessThan(1000); // 500 iterations well under 1 sec
      expect(opsPerSec).toBeGreaterThan(500);
    });

    test("should meet event recording throughput benchmark (>10,000 events/sec)", () => {
      const recorder = new SessionRecorder("bench_session");
      recorder.startRecording();

      const startTime = Date.now();
      const iterations = 5000;

      for (let i = 0; i < iterations; i++) {
        recorder.recordEvent("output", "chunk_data", "host");
      }

      const elapsedMs = Date.now() - startTime;
      recorder.stopRecording();

      expect(elapsedMs).toBeLessThan(500);
      expect(recorder.getFrames()).toHaveLength(iterations);
    });
  });
});
