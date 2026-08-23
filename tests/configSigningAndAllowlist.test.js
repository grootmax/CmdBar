import fs from "fs";
import path from "path";
import os from "os";
import {
  loadConfig,
  saveConfig,
  getOrCreateSigningKey,
  computeSignature,
  verifyConfigSignature,
  getKeyPath,
  DEFAULT_CONFIG,
} from "../extension/configSync.js";
import { isBinaryAllowlisted } from "../extension/commandProcessor.js";

describe("Cryptographic Config Signing & Path Allowlisting Unit Tests", () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-sign-test-"));
    configPath = path.join(tempDir, "cmdbar", "config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Cryptographic Config Signing & Verification (Requirements 1 & 2)", () => {
    test("saveConfig attaches a valid HMAC-SHA256 signature to the configuration file", async () => {
      const config = {
        categories: [
          {
            name: "Allowed Commands",
            commands: [{ name: "Echo", command: "echo Hello" }],
          },
        ],
      };

      await saveConfig(config, configPath);

      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, "utf8");
      const savedData = JSON.parse(content);

      expect(savedData.signature).toBeDefined();
      expect(typeof savedData.signature).toBe("string");
      expect(savedData.signature.length).toBe(64); // SHA-256 hex string

      // Verify signature using helper
      const keyPath = getKeyPath(configPath);
      const isValid = await verifyConfigSignature(savedData, keyPath);
      expect(isValid).toBe(true);
    });

    test("loadConfig successfully loads a signed configuration file", async () => {
      const config = {
        categories: [
          {
            name: "Signed Cat",
            commands: [{ name: "Ping", command: "ping -c 1 127.0.0.1" }],
          },
        ],
      };

      await saveConfig(config, configPath);
      const loaded = await loadConfig(configPath);

      expect(loaded.categories[0].name).toBe("Signed Cat");
      expect(loaded.categories[0].commands[0].name).toBe("Ping");
    });

    test("loadConfig rejects tampered config files modified without valid signature, archives to .bak, and restores default config (Requirement 4)", async () => {
      const validConfig = {
        categories: [
          {
            name: "Original",
            commands: [{ name: "Original Cmd", command: "echo original" }],
          },
        ],
      };

      await saveConfig(validConfig, configPath);

      // Tamper with the file directly (e.g. background process modifying shortcut)
      const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      fileContent.categories[0].commands[0].command = "/tmp/malicious_exploit";
      // Do NOT re-sign or update signature!
      fs.writeFileSync(configPath, JSON.stringify(fileContent, null, 2));

      // Attempt to load the tampered config
      const loaded = await loadConfig(configPath);

      // Must reject tampered file and fall back to safe default
      expect(loaded).toEqual(DEFAULT_CONFIG);

      // Must archive tampered file to .bak
      const backupPath = configPath + ".bak";
      expect(fs.existsSync(backupPath)).toBe(true);
      const backedUpData = JSON.parse(fs.readFileSync(backupPath, "utf8"));
      expect(backedUpData.categories[0].commands[0].command).toBe(
        "/tmp/malicious_exploit",
      );
    });

    test("loadConfig rejects configuration files missing a signature attribute", async () => {
      const unsignedConfig = {
        categories: [
          {
            name: "Unsigned",
            commands: [{ name: "Unsigned Cmd", command: "echo test" }],
          },
        ],
      };

      fs.writeFileSync(configPath, JSON.stringify(unsignedConfig, null, 2));

      const loaded = await loadConfig(configPath);

      expect(loaded).toEqual(DEFAULT_CONFIG);
      expect(fs.existsSync(configPath + ".bak")).toBe(true);
    });

    test("secret key file .key is created with 0600 permissions and persists", async () => {
      const keyPath = getKeyPath(configPath);
      expect(fs.existsSync(keyPath)).toBe(false);

      const key1 = await getOrCreateSigningKey(keyPath);
      expect(fs.existsSync(keyPath)).toBe(true);
      expect(key1.length).toBeGreaterThan(0);

      const stats = fs.statSync(keyPath);
      // Permissions should end with 600 in octal (0o600 -> 384 decimal)
      expect(stats.mode & 0o777).toBe(0o600);

      const key2 = await getOrCreateSigningKey(keyPath);
      expect(key2).toBe(key1);
    });
  });

  describe("Binary Executable Path Allowlisting (Requirement 3)", () => {
    test("allows approved system binaries and paths", () => {
      expect(isBinaryAllowlisted("/usr/bin/make")).toBe(true);
      expect(isBinaryAllowlisted("/bin/echo")).toBe(true);
      expect(isBinaryAllowlisted("/usr/bin/ping")).toBe(true);
      expect(isBinaryAllowlisted("/usr/local/bin/deploy")).toBe(true);
      expect(isBinaryAllowlisted("make")).toBe(true);
      expect(isBinaryAllowlisted("echo")).toBe(true);
      expect(isBinaryAllowlisted("aws")).toBe(true);
      expect(isBinaryAllowlisted("deploy")).toBe(true);
      expect(isBinaryAllowlisted("git")).toBe(true);
      expect(isBinaryAllowlisted("docker")).toBe(true);
    });

    test("rejects non-allowlisted binary paths and suspicious scripts", () => {
      expect(isBinaryAllowlisted("/tmp/malicious_binary")).toBe(false);
      expect(isBinaryAllowlisted("/home/user/downloads/exploit")).toBe(false);
      expect(isBinaryAllowlisted("/var/tmp/hack")).toBe(false);
      expect(isBinaryAllowlisted("unknown_untrusted_bin")).toBe(false);
      expect(isBinaryAllowlisted("../relative_script.sh")).toBe(false);
      expect(isBinaryAllowlisted("./script.sh")).toBe(false);
      expect(isBinaryAllowlisted("")).toBe(false);
      expect(isBinaryAllowlisted(null)).toBe(false);
    });

    test("supports custom allowlist entries when provided", () => {
      const customAllowlist = ["/opt/customapp/bin/tool", "/custom/dir/"];
      expect(
        isBinaryAllowlisted("/opt/customapp/bin/tool", customAllowlist),
      ).toBe(true);
      expect(isBinaryAllowlisted("/custom/dir/mytool", customAllowlist)).toBe(
        true,
      );
      expect(isBinaryAllowlisted("/unauthorized/path", customAllowlist)).toBe(
        false,
      );
    });
  });
});
