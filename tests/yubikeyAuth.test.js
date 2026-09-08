import {
  YUBIKEY_MODES,
  isCommandSensitive,
  validateModHex,
  parseOtp,
  verifyTouch,
  verifyOTP,
  createChallenge,
  verifyFIDO2Assertion,
  generateEmergencyCodes,
  verifyEmergencyCode,
  registerDevice,
  YubiKeyAuthManager,
} from "../extension/yubikeyAuth.js";

import { CmdBarDBusService } from "../extension/dbusService.js";
import { DEFAULT_CONFIG } from "../extension/configSync.js";

describe("YubiKey 2FA Authentication Unit & Integration Tests", () => {
  describe("Sensitive Command Detection (isCommandSensitive)", () => {
    test("detects explicit sensitive flags on command object", () => {
      expect(isCommandSensitive({ command: "echo hello", sensitive: true })).toBe(true);
      expect(isCommandSensitive({ command: "echo hello", require_2fa: true })).toBe(true);
      expect(isCommandSensitive({ command: "echo hello", require_yubikey: true })).toBe(true);
      expect(isCommandSensitive({ command: "echo hello", sensitive: false })).toBe(false);
    });

    test("detects dangerous command patterns automatically", () => {
      expect(isCommandSensitive("sudo apt update")).toBe(true);
      expect(isCommandSensitive("rm -rf /tmp/test")).toBe(true);
      expect(isCommandSensitive("dd if=/dev/zero of=/dev/null")).toBe(true);
      expect(isCommandSensitive("systemctl stop nginx")).toBe(true);
      expect(isCommandSensitive("aws ecs update-service --cluster prod")).toBe(true);
      expect(isCommandSensitive("kubectl delete pod my-pod")).toBe(true);
      expect(isCommandSensitive("deploy production")).toBe(true);
      expect(isCommandSensitive("shutdown -h now")).toBe(true);
    });

    test("returns false for non-sensitive commands", () => {
      expect(isCommandSensitive("echo Hello World")).toBe(false);
      expect(isCommandSensitive("git status")).toBe(false);
      expect(isCommandSensitive("ping -c 3 127.0.0.1")).toBe(false);
      expect(isCommandSensitive(null)).toBe(false);
      expect(isCommandSensitive("")).toBe(false);
    });
  });

  describe("Yubico OTP Parsing & Validation (parseOtp & validateModHex)", () => {
    test("validates ModHex encoded string", () => {
      expect(validateModHex("cbdefghijklnrtuv")).toBe(true);
      expect(validateModHex("vvccccccvccc")).toBe(true);
      expect(validateModHex("123456")).toBe(false);
      expect(validateModHex("xyz123")).toBe(false);
      expect(validateModHex("")).toBe(false);
    });

    test("parses valid 44-character Yubico OTP token", () => {
      const otp = "vvccccccvccc" + "cbdefghijklnrtuvcbdefghijklnrtuv";
      const parsed = parseOtp(otp);
      expect(parsed.valid).toBe(true);
      expect(parsed.deviceId).toBe("vvccccccvccc");
      expect(parsed.payload.length).toBe(32);
    });

    test("rejects invalid length or characters in OTP", () => {
      expect(parseOtp("shortotp").valid).toBe(false);
      expect(parseOtp("vvccccccvcccinvalidcharshere!@#$%^&*()_+12345").valid).toBe(false);
      expect(parseOtp(null).valid).toBe(false);
    });
  });

  describe("Touch-to-Confirm Presence Verification (verifyTouch)", () => {
    test("verifies hardware touch successfully", async () => {
      const res = await verifyTouch({ timeoutSeconds: 30, simulatedTouch: true });
      expect(res.success).toBe(true);
      expect(res.message).toContain("confirmed");
    });

    test("handles touch timeout / failure scenario", async () => {
      const res = await verifyTouch({ timeoutSeconds: 5, failTouch: true });
      expect(res.success).toBe(false);
      expect(res.message).toContain("failed");
    });
  });

  describe("YubiKey OTP Authentication (verifyOTP)", () => {
    const validOtp = "vvccccccvccc" + "cbdefghijklnrtuvcbdefghijklnrtuv";

    test("validates OTP when no keys registered (open mode)", async () => {
      const res = await verifyOTP(validOtp, { registeredKeys: [] });
      expect(res.success).toBe(true);
      expect(res.deviceId).toBe("vvccccccvccc");
    });

    test("verifies OTP against registered key device ID", async () => {
      const keys = [{ name: "Key 1", device_id: "vvccccccvccc" }];
      const res = await verifyOTP(validOtp, { registeredKeys: keys });
      expect(res.success).toBe(true);
    });

    test("rejects OTP from unregistered key device ID", async () => {
      const keys = [{ name: "Other Key", device_id: "kkkkkkkkkkkk" }];
      const res = await verifyOTP(validOtp, { registeredKeys: keys });
      expect(res.success).toBe(false);
      expect(res.message).toContain("not registered");
    });
  });

  describe("FIDO2 / U2F Assertion Verification (verifyFIDO2Assertion)", () => {
    test("generates cryptographic challenge", () => {
      const challenge = createChallenge(32);
      expect(typeof challenge).toBe("string");
      expect(challenge.length).toBe(32);
    });

    test("verifies valid FIDO2 assertion signature", async () => {
      const challenge = "test_challenge_1234567890123456";
      const publicKey = "test_public_key_abc123";
      const signature = `sig_${challenge}_${publicKey}`;

      const res = await verifyFIDO2Assertion(challenge, signature, publicKey);
      expect(res.success).toBe(true);
      expect(res.message).toContain("verified");
    });

    test("rejects missing signature or public key", async () => {
      const res1 = await verifyFIDO2Assertion("challenge", "", "pubkey");
      expect(res1.success).toBe(false);

      const res2 = await verifyFIDO2Assertion("challenge", "sig", "");
      expect(res2.success).toBe(false);
    });
  });

  describe("Emergency Recovery Codes (generateEmergencyCodes & verifyEmergencyCode)", () => {
    test("generates requested number of emergency codes", () => {
      const codes = generateEmergencyCodes(5);
      expect(codes.length).toBe(5);
      codes.forEach((c) => {
        expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      });
    });

    test("verifies valid emergency code and consumes it (single-use)", async () => {
      const codes = ["A1B2-C3D4", "E5F6-G7H8"];
      const res = await verifyEmergencyCode("A1B2-C3D4", codes);

      expect(res.success).toBe(true);
      expect(res.remainingCodes.length).toBe(1);
      expect(res.remainingCodes).not.toContain("A1B2-C3D4");
      expect(res.remainingCodes).toContain("E5F6-G7H8");
    });

    test("rejects invalid emergency code", async () => {
      const codes = ["A1B2-C3D4"];
      const res = await verifyEmergencyCode("WRONG-CODE", codes);

      expect(res.success).toBe(false);
      expect(res.remainingCodes.length).toBe(1);
    });
  });

  describe("Device Registration (registerDevice)", () => {
    test("registers a new YubiKey hardware device", () => {
      const dev = { name: "Primary YubiKey", device_id: "vvccccccvccc", serial: "123456" };
      const res = registerDevice(dev, []);

      expect(res.success).toBe(true);
      expect(res.keys.length).toBe(1);
      expect(res.keys[0].name).toBe("Primary YubiKey");
      expect(res.keys[0].device_id).toBe("vvccccccvccc");
      expect(res.keys[0].created_at).toBeDefined();
    });

    test("updates existing device registration with matching device_id", () => {
      const initialKeys = [{ id: "key_1", name: "Old Name", device_id: "vvccccccvccc" }];
      const updatedDev = { name: "Updated Name", device_id: "vvccccccvccc" };
      const res = registerDevice(updatedDev, initialKeys);

      expect(res.success).toBe(true);
      expect(res.keys.length).toBe(1);
      expect(res.keys[0].name).toBe("Updated Name");
    });
  });

  describe("YubiKeyAuthManager Integration", () => {
    test("bypasses authentication when YubiKey 2FA is disabled", async () => {
      const manager = new YubiKeyAuthManager({ yubikey: { enabled: false } });
      const res = await manager.authenticateCommand({ command: "sudo rm -rf /tmp" });
      expect(res.success).toBe(true);
      expect(res.modeUsed).toBe("none");
    });

    test("authenticates sensitive command using Touch mode", async () => {
      const manager = new YubiKeyAuthManager({
        yubikey: { enabled: true, mode: YUBIKEY_MODES.TOUCH, require_for_sensitive: true },
      });

      const res = await manager.authenticateCommand({ command: "sudo apt update" });
      expect(res.success).toBe(true);
      expect(res.modeUsed).toBe(YUBIKEY_MODES.TOUCH);
    });

    test("authenticates sensitive command using OTP mode", async () => {
      const validOtp = "vvccccccvccc" + "cbdefghijklnrtuvcbdefghijklnrtuv";
      const manager = new YubiKeyAuthManager({
        yubikey: {
          enabled: true,
          mode: YUBIKEY_MODES.OTP,
          keys: [{ device_id: "vvccccccvccc" }],
        },
      });

      const res = await manager.authenticateCommand(
        { command: "deploy production" },
        { otpToken: validOtp }
      );
      expect(res.success).toBe(true);
      expect(res.modeUsed).toBe(YUBIKEY_MODES.OTP);
    });

    test("allows emergency recovery code bypass when required", async () => {
      const manager = new YubiKeyAuthManager({
        yubikey: {
          enabled: true,
          mode: YUBIKEY_MODES.TOUCH,
          emergency_codes: ["EMERG123-CODE"],
        },
      });

      const res = await manager.authenticateCommand(
        { command: "sudo reboot" },
        { emergencyCode: "EMERG123-CODE" }
      );

      expect(res.success).toBe(true);
      expect(res.modeUsed).toBe("emergency");
      expect(res.remainingEmergencyCodes.length).toBe(0);
    });
  });

  describe("DEFAULT_CONFIG Schema Integration", () => {
    test("contains default yubikey configuration structure", () => {
      expect(DEFAULT_CONFIG.yubikey).toBeDefined();
      expect(DEFAULT_CONFIG.yubikey.enabled).toBe(false);
      expect(DEFAULT_CONFIG.yubikey.mode).toBe("touch");
      expect(DEFAULT_CONFIG.yubikey.require_for_sensitive).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.yubikey.keys)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.yubikey.emergency_codes)).toBe(true);
    });
  });

  describe("D-Bus API Endpoints for YubiKey", () => {
    test("GetYubiKeyStatus returns status JSON string", async () => {
      const service = new CmdBarDBusService(null);
      const statusJson = await service.GetYubiKeyStatus();
      const status = JSON.parse(statusJson);

      expect(status.enabled).toBeDefined();
      expect(status.mode).toBeDefined();
      expect(status.key_count).toBeDefined();
    });

    test("RegisterYubiKeyDevice registers device via D-Bus API", async () => {
      const service = new CmdBarDBusService(null);
      const devJson = JSON.stringify({ name: "DBus Key", device_id: "vvccccccvccc" });
      const ok = await service.RegisterYubiKeyDevice(devJson);
      expect(ok).toBe(true);
    });
  });
});
