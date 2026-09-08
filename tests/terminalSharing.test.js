import {
  E2EEncryptionManager,
  CursorTracker,
  PermissionManager,
  SessionRecorder,
  WebRTCSharingChannel,
  TerminalSharingSession,
  Role,
  SessionState,
  ConnectionState,
  EventType,
} from "../extension/terminalSharing.js";
import { CmdBarDBusService } from "../extension/dbusService.js";

describe("Live Terminal Sharing Core Suite", () => {
  describe("E2E Encryption Manager", () => {
    test("Generates 256-bit symmetric key and derives key from passphrase", () => {
      const encMgr1 = new E2EEncryptionManager();
      expect(encMgr1.key).toBeDefined();
      expect(encMgr1.key.length).toBe(64);

      const encMgr2 = new E2EEncryptionManager("my-secret-passphrase");
      expect(encMgr2.key.length).toBe(64);
    });

    test("Encrypts and decrypts string data seamlessly", () => {
      const encMgr = new E2EEncryptionManager("secure-session-key-1234567890123");
      const sampleText = "echo 'Hello Collaborative Terminal World!'";

      const encrypted = encMgr.encrypt(sampleText);
      expect(encrypted).toHaveProperty("ciphertext");
      expect(encrypted).toHaveProperty("iv");

      const decrypted = encMgr.decrypt(encrypted);
      expect(decrypted).toBe(sampleText);
    });

    test("Encrypts and decrypts object data seamlessly", () => {
      const encMgr = new E2EEncryptionManager();
      const sampleObj = { command: "git status", exitCode: 0, flags: ["--short"] };

      const encrypted = encMgr.encrypt(sampleObj);
      const decrypted = encMgr.decrypt(encrypted);
      expect(decrypted).toEqual(sampleObj);
    });

    test("Handles fallback XOR encryption and decryption", () => {
      const encMgr = new E2EEncryptionManager("fallback-key");
      const fallbackEnc = encMgr._fallbackEncrypt("Secret Fallback Data");
      expect(fallbackEnc.algorithm).toBe("XOR-HMAC-FALLBACK");

      const fallbackDec = encMgr._fallbackDecrypt(fallbackEnc);
      expect(fallbackDec).toBe("Secret Fallback Data");
    });

    test("Throws error on invalid key during decryption", () => {
      const encMgrHost = new E2EEncryptionManager("host-key-12345678901234567890123456789012");
      const encMgrHacker = new E2EEncryptionManager("wrong-key-123456789012345678901234567890");

      const encrypted = encMgrHost.encrypt("Super Secret Admin Command");
      expect(() => {
        encMgrHacker.decrypt(encrypted);
      }).toThrow();
    });
  });

  describe("Cursor Tracker", () => {
    let tracker;

    beforeEach(() => {
      tracker = new CursorTracker();
    });

    test("Updates and retrieves participant cursor position", () => {
      const cursor = tracker.updateCursor("peer1", {
        line: 12,
        col: 24,
        visible: true,
        name: "Alice",
        color: "#ff0000",
      });

      expect(cursor.participantId).toBe("peer1");
      expect(cursor.line).toBe(12);
      expect(cursor.col).toBe(24);
      expect(cursor.name).toBe("Alice");

      const retrieved = tracker.getCursor("peer1");
      expect(retrieved).toEqual(cursor);
    });

    test("Lists all active cursors and removes cursor when participant leaves", () => {
      tracker.updateCursor("peer1", { line: 1, col: 2, name: "Alice" });
      tracker.updateCursor("peer2", { line: 5, col: 10, name: "Bob" });

      expect(tracker.getAllCursors().length).toBe(2);

      tracker.removeCursor("peer1");
      expect(tracker.getAllCursors().length).toBe(1);
      expect(tracker.getCursor("peer1")).toBeNull();
    });
  });

  describe("Permission Control Manager", () => {
    let permMgr;

    beforeEach(() => {
      permMgr = new PermissionManager(Role.VIEWER);
      permMgr.setRole("host1", Role.HOST);
      permMgr.setRole("viewer1", Role.VIEWER);
    });

    test("Enforces role-based write access", () => {
      expect(permMgr.canWrite("host1")).toBe(true);
      expect(permMgr.canWrite("viewer1")).toBe(false);
    });

    test("Handles permission request, grant, and revoke workflow", () => {
      const req = permMgr.requestControl("viewer1", "Need to execute build script");
      expect(req.status).toBe("pending");
      expect(permMgr.getPendingRequests().length).toBe(1);

      // Grant control -> upgrade to EDITOR
      const granted = permMgr.grantControl("viewer1");
      expect(granted).toBe(true);
      expect(permMgr.canWrite("viewer1")).toBe(true);
      expect(permMgr.getRole("viewer1")).toBe(Role.EDITOR);

      // Revoke control -> downgrade to VIEWER
      const revoked = permMgr.revokeControl("viewer1");
      expect(revoked).toBe(true);
      expect(permMgr.canWrite("viewer1")).toBe(false);
    });

    test("Prevents revoking Host write permission", () => {
      expect(() => {
        permMgr.revokeControl("host1");
      }).toThrow("Cannot revoke write permission from Host");
    });
  });

  describe("Session Recorder", () => {
    let recorder;

    beforeEach(() => {
      recorder = new SessionRecorder();
    });

    test("Records session frames and handles pause/resume", () => {
      recorder.start();
      recorder.recordFrame(EventType.OUTPUT, "hello\n", "host");
      recorder.recordFrame(EventType.INPUT, "ls -la\n", "editor1");

      expect(recorder.getFrames().length).toBe(2);

      recorder.pause();
      recorder.recordFrame(EventType.OUTPUT, "ignored while paused", "host");
      expect(recorder.getFrames().length).toBe(2);

      recorder.resume();
      recorder.recordFrame(EventType.OUTPUT, "resumed output\n", "host");
      expect(recorder.getFrames().length).toBe(3);

      recorder.stop();
    });

    test("Exports recording to JSON format", () => {
      recorder.start();
      recorder.recordFrame(EventType.OUTPUT, "Testing JSON export", "host");
      recorder.stop();

      const jsonExport = recorder.exportJSON();
      const parsed = JSON.parse(jsonExport);
      expect(parsed.totalFrames).toBe(1);
      expect(parsed.frames[0].payload).toBe("Testing JSON export");
    });

    test("Exports recording to Asciinema v2 format", () => {
      recorder.start();
      recorder.recordFrame(EventType.OUTPUT, "root@cmdbar:~# ", "host");
      recorder.recordFrame(EventType.INPUT, "uname -a\n", "editor1");
      recorder.stop();

      const asciinemaExport = recorder.exportAsciinema({ title: "Asciinema Test" });
      expect(asciinemaExport).toContain('"version":2');
      expect(asciinemaExport).toContain('Asciinema Test');
      expect(asciinemaExport).toContain('"o"');
      expect(asciinemaExport).toContain('"i"');
    });
  });

  describe("WebRTC Sharing Channel", () => {
    let channel;

    beforeEach(() => {
      channel = new WebRTCSharingChannel({ sessionId: "sess-101" });
    });

    test("Handles SDP offer and answer exchange", () => {
      const offer = channel.createOffer("peerB");
      expect(offer.type).toBe("offer");
      expect(channel.connectionState).toBe(ConnectionState.CONNECTING);

      const answer = channel.handleOffer("peerA", offer);
      expect(answer.type).toBe("answer");
      expect(channel.connectionState).toBe(ConnectionState.CONNECTED);

      const handled = channel.handleAnswer("peerB", answer);
      expect(handled).toBe(true);
    });

    test("Dispatches and broadcasts channel messages", () => {
      let receivedMsg = null;
      let receivedSender = null;

      channel.onMessage((msg, sender) => {
        receivedMsg = msg;
        receivedSender = sender;
      });

      channel.createOffer("peer1");
      channel.broadcast({ type: EventType.OUTPUT, text: "Broadcast Test" });

      expect(receivedMsg).toEqual({ type: EventType.OUTPUT, text: "Broadcast Test" });
    });

    test("Handles ICE candidates and closing channel", () => {
      const added = channel.addIceCandidate("peer1", { candidate: "candidate:1 1 UDP 12345" });
      expect(added).toBe(true);
      expect(channel.addIceCandidate("peer1", null)).toBe(false);

      channel.close();
      expect(channel.connectionState).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe("Terminal Sharing Session Integration", () => {
    let session;

    beforeEach(() => {
      session = new TerminalSharingSession({
        sessionId: "integration-session-001",
        title: "Team Shell Pair Programming",
        host: { id: "host1", name: "Alice Host" },
        maxParticipants: 5,
        e2eEnabled: true,
        secretKey: "shared-e2e-passphrase",
      });
      session.start();
    });

    test("Participant join and leave flow", () => {
      const bob = session.joinParticipant({ id: "bob", name: "Bob Developer", role: Role.VIEWER });
      expect(bob.role).toBe(Role.VIEWER);
      expect(session.getParticipants().length).toBe(2);

      const left = session.leaveParticipant("bob");
      expect(left).toBe(true);
      expect(session.getParticipants().length).toBe(1);
    });

    test("Host output broadcasting and E2E encryption", () => {
      const outputFrame = session.broadcastOutput("Processing deployment pipeline...\nDone!");
      expect(outputFrame.type).toBe(EventType.OUTPUT);
      expect(outputFrame.isEncrypted).toBe(true);

      const decryptedPayload = session.encryptionManager.decrypt(outputFrame.payload);
      expect(decryptedPayload).toBe("Processing deployment pipeline...\nDone!");
    });

    test("Participant input permission enforcement", () => {
      session.joinParticipant({ id: "charlie", name: "Charlie Viewer", role: Role.VIEWER });

      // Charlie viewer should NOT be allowed to send input
      expect(() => {
        session.sendInput("charlie", "rm -rf /");
      }).toThrow("Participant 'charlie' does not have write permission");

      // Request control -> Grant control -> Send input
      session.requestInputPermission("charlie", "Need to test command");
      session.grantInputPermission("host1", "charlie");

      const inputFrame = session.sendInput("charlie", "ls -la\n");
      expect(inputFrame.senderId).toBe("charlie");
    });

    test("Full session recording and export integration", () => {
      session.startRecording();
      session.joinParticipant({ id: "dave", name: "Dave Editor", role: Role.EDITOR });

      session.broadcastOutput("$ ");
      session.sendInput("dave", "make test\n");
      session.updateCursorPosition("dave", { line: 1, col: 10 });

      session.pauseRecording();
      session.resumeRecording();
      session.stopRecording();

      const asciinema = session.exportRecording("asciinema");
      expect(asciinema).toContain("make test");

      const jsonLog = session.exportRecording("json");
      expect(jsonLog).toContain("make test");
    });

    test("Emits session events to registered callbacks", () => {
      const events = [];
      session.onEvent((event, data) => events.push(event));

      session.requestInputPermission("peerX", "test");
      expect(events).toContain("permission_requested");
    });

    test("Performance Benchmarks & Metrics", () => {
      session.startRecording();
      const iterations = 1000;
      const tStart = Date.now();

      for (let i = 0; i < iterations; i++) {
        session.broadcastOutput(`Frame chunk output ${i}\n`);
      }

      const totalTimeMs = Date.now() - tStart;
      const metrics = session.getMetrics();

      expect(metrics.framesProcessed).toBeGreaterThanOrEqual(iterations);
      expect(metrics.avgLatencyMs).toBeLessThan(5); // Benchmark requirement: <5ms per frame
      expect(totalTimeMs).toBeLessThan(2000); // Throughput benchmark requirement
    });

    test("Cleans up session upon endSession", () => {
      session.endSession();
      expect(session.state).toBe(SessionState.ENDED);
      expect(session.getParticipants().length).toBe(0);
    });
  });

  describe("D-Bus API Live Terminal Sharing Methods", () => {
    test("Starts, lists, and stops terminal sharing sessions via D-Bus service", async () => {
      const dbusService = new CmdBarDBusService();

      const startResStr = await dbusService.StartTerminalSharing("dbus-sess-1", "D-Bus Shared Terminal");
      const startRes = JSON.parse(startResStr);
      expect(startRes.sessionId).toBe("dbus-sess-1");

      const listResStr = await dbusService.GetTerminalSharingSessions();
      const listRes = JSON.parse(listResStr);
      expect(listRes.length).toBe(1);
      expect(listRes[0].sessionId).toBe("dbus-sess-1");

      const stopRes = await dbusService.StopTerminalSharing("dbus-sess-1");
      expect(stopRes).toBe(true);

      const listResAfterStr = await dbusService.GetTerminalSharingSessions();
      const listResAfter = JSON.parse(listResAfterStr);
      expect(listResAfter.length).toBe(0);
    });
  });
});
