import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import {
  validateInput,
  hasPlaceholder,
  substituteCommand,
  fuzzyMatch,
  highlightMatches,
  rankCommands,
  detectFormat,
  formatOutput,
  validateYubicoOTP,
  verifyFIDO2Assertion,
  isSensitiveCommand,
  generateEmergencyCodes,
  verifyAndConsumeEmergencyCode,
  authenticateCommand,
  benchmarkYubikeyAuth,
} from "./extension/commandProcessor.js";
import {
  saveConfigAtomically,
  saveConfigAtomicallyAsync,
} from "./companion/configStore.js";

console.log("Running standalone verification tests...");

try {
  // 1. validateInput Tests
  assert.strictEqual(
    validateInput(""),
    false,
    "Empty input should fail validation",
  );
  assert.strictEqual(
    validateInput("   "),
    false,
    "Whitespace input should fail validation",
  );
  assert.strictEqual(
    validateInput(null),
    false,
    "Null input should fail validation",
  );
  assert.strictEqual(
    validateInput(undefined),
    false,
    "Undefined input should fail validation",
  );
  assert.strictEqual(
    validateInput("my-val"),
    true,
    "Valid string input should pass validation",
  );
  assert.strictEqual(
    validateInput("  my-val  "),
    true,
    "Padded string input should pass validation",
  );

  // 2. hasPlaceholder Tests
  assert.strictEqual(
    hasPlaceholder("echo <task-id>"),
    true,
    "Should detect <...> placeholder",
  );
  assert.strictEqual(
    hasPlaceholder("deploy {{service}}"),
    true,
    "Should detect {{...}} placeholder",
  );
  assert.strictEqual(
    hasPlaceholder("git checkout {branch}"),
    true,
    "Should detect {...} single brace placeholder",
  );
  assert.strictEqual(
    hasPlaceholder("make build"),
    false,
    "Should return false when no placeholders exist",
  );
  assert.strictEqual(
    hasPlaceholder(""),
    false,
    "Should handle empty string gracefully",
  );

  // 3. substituteCommand Tests
  assert.strictEqual(
    substituteCommand("echo <task-id>", "999"),
    "echo 999",
    "Should replace angle bracket placeholder",
  );
  assert.strictEqual(
    substituteCommand("deploy {{service}}", "api"),
    "deploy api",
    "Should replace double curly placeholder",
  );
  assert.strictEqual(
    substituteCommand("git checkout {branch}", "main"),
    "git checkout main",
    "Should replace single curly placeholder",
  );
  assert.strictEqual(
    substituteCommand("echo <task-id> and <task-id>", "123"),
    "echo 123 and 123",
    "Should replace multiple placeholders",
  );
  assert.strictEqual(
    substituteCommand(null, "val"),
    "",
    "Should handle null template gracefully",
  );

  // 4. Fuzzy Matching & Highlighting Tests
  const res = fuzzyMatch("gp", "git push origin");
  assert.strictEqual(res.match, true, "gp should match git push origin");
  assert.deepStrictEqual(
    res.matches,
    [0, 4],
    "gp should match indices 0 and 4",
  );
  assert.strictEqual(
    highlightMatches("git push origin", res.matches),
    "<b>g</b>it <b>p</b>ush origin",
    "Should highlight matched chars",
  );

  const ranked = rankCommands(
    [
      { name: "Git Push", command: "git push origin" },
      { name: "Git Pull", command: "git pull origin" },
    ],
    "gp",
    { "git pull origin": 5 },
  );
  assert.strictEqual(
    ranked[0].command.name,
    "Git Pull",
    "Should rank higher usage frequency first",
  );

  // 5. Output Formatter Tests
  assert.strictEqual(
    detectFormat('{"a":1}'),
    "json",
    "Should detect JSON format",
  );
  assert.strictEqual(
    detectFormat("A,B\n1,2"),
    "csv",
    "Should detect CSV format",
  );
  assert.strictEqual(
    detectFormat("A\tB\n1\t2"),
    "tsv",
    "Should detect TSV format",
  );
  assert.strictEqual(
    detectFormat("function foo() {}"),
    "code",
    "Should detect Code format",
  );

  const jsonFmt = formatOutput('{"key":"val"}');
  assert.strictEqual(jsonFmt.format, "json", "formatOutput should detect json");
  assert.strictEqual(
    jsonFmt.text,
    '{\n  "key": "val"\n}',
    "JSON should be pretty printed",
  );

  const csvFmt = formatOutput("Name,Role\nAlice,Admin");
  assert.strictEqual(csvFmt.format, "csv", "formatOutput should detect csv");
  assert.ok(
    csvFmt.text.includes("+-------+-------+"),
    "CSV should render table border",
  );

  // 6. Atomic Persistence Tests (Sync & Async)
  const tempDir = path.join(
    os.tmpdir(),
    `cmdbar-standalone-test-${Date.now()}`,
  );
  const tempFile = path.join(tempDir, "config.json");

  // Synchronous write test
  const testDataSync = { val: "sync-data" };
  saveConfigAtomically(testDataSync, tempFile);
  assert.strictEqual(
    fs.existsSync(tempFile),
    true,
    "Temp file should be created synchronously",
  );
  const readDataSync = JSON.parse(fs.readFileSync(tempFile, "utf8"));
  assert.deepStrictEqual(
    readDataSync,
    testDataSync,
    "Written data should match source data (sync)",
  );

  // Asynchronous write test
  const testDataAsync = { val: "async-data" };
  await saveConfigAtomicallyAsync(testDataAsync, tempFile);
  assert.strictEqual(
    fs.existsSync(tempFile),
    true,
    "Temp file should be created asynchronously",
  );
  const readDataAsync = JSON.parse(fs.readFileSync(tempFile, "utf8"));
  assert.deepStrictEqual(
    readDataAsync,
    testDataAsync,
    "Written data should match source data (async)",
  );

  // 7. YubiKey 2FA Verification Tests
  const otpRes = validateYubicoOTP(
    "ccccccbedvcebcgdehbcfnhfhkfvvtrgeubfnfgnrtgr",
    "ccccccbedvce",
  );
  assert.strictEqual(
    otpRes.valid,
    true,
    "Valid 44-char modhex OTP should pass verification",
  );

  const fidoRes = verifyFIDO2Assertion(
    { user_presence: true, signature: "mock_valid" },
    "test_challenge",
  );
  assert.strictEqual(
    fidoRes.valid,
    true,
    "Valid FIDO2 presence assertion should pass verification",
  );

  assert.strictEqual(
    isSensitiveCommand({ command: "sudo apt update" }),
    true,
    "sudo command should be detected as sensitive",
  );
  assert.strictEqual(
    isSensitiveCommand({ command: "echo hello" }),
    false,
    "echo command should not be detected as sensitive",
  );

  const { rawCodes, hashedCodes } = await generateEmergencyCodes(3);
  assert.strictEqual(rawCodes.length, 3, "Should generate 3 emergency codes");
  assert.strictEqual(hashedCodes.length, 3, "Should generate 3 hashed codes");

  const emergencyCfg = { emergency_codes: [...hashedCodes] };
  const consumeRes = await verifyAndConsumeEmergencyCode(
    rawCodes[0],
    emergencyCfg,
  );
  assert.strictEqual(
    consumeRes.valid,
    true,
    "Valid emergency code should be consumed",
  );
  assert.strictEqual(
    emergencyCfg.emergency_codes.length,
    2,
    "Consumed code should be removed from list",
  );

  const authRes = await authenticateCommand(
    { command: "sudo reboot" },
    { mode: "emergency", emergencyCode: rawCodes[1] },
    { yubikey: emergencyCfg },
  );
  assert.strictEqual(
    authRes.success,
    true,
    "Emergency code auth for sensitive command should succeed",
  );

  const bench = await benchmarkYubikeyAuth(50);
  assert.strictEqual(
    bench.totalPassedBenchmark,
    true,
    "YubiKey auth benchmark should complete under 50ms",
  );

  // Cleanup temp files & dir
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("✅ Standalone verification tests completed successfully!");
  process.exit(0);
} catch (error) {
  console.error("❌ Standalone verification tests failed:");
  console.error(error);
  process.exit(1);
}
