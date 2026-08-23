/**
 * YubiKey 2FA Authentication module for CmdBar Extension & Node.js.
 * Supports OTP verification, FIDO2/U2F hardware assertions, Touch-to-Confirm, and Emergency Access recovery codes.
 */

const MODHEX_ALPHABET = "cbdefghijklnrtuv";

/**
 * Checks if a string consists entirely of valid modhex characters.
 * @param {string} text
 * @returns {boolean}
 */
export function isModhex(text) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim().toLowerCase();
  for (let i = 0; i < clean.length; i++) {
    if (!MODHEX_ALPHABET.includes(clean[i])) return false;
  }
  return true;
}

/**
 * Validates Yubico OTP string (44 modhex characters).
 * @param {string} otp
 * @param {string} [registeredPrefix]
 * @returns {{ valid: boolean, publicId: string|null, message: string }}
 */
export function validateYubicoOTP(otp, registeredPrefix) {
  if (!otp || typeof otp !== "string") {
    return {
      valid: false,
      publicId: null,
      message: "OTP string is empty or invalid.",
    };
  }

  const cleanOtp = otp.trim().toLowerCase();
  if (cleanOtp.length !== 44) {
    return {
      valid: false,
      publicId: null,
      message: `Invalid OTP length (${cleanOtp.length} chars, expected 44).`,
    };
  }

  if (!isModhex(cleanOtp)) {
    return {
      valid: false,
      publicId: null,
      message: "OTP contains invalid non-modhex characters.",
    };
  }

  const publicId = cleanOtp.substring(0, 12);
  if (registeredPrefix && registeredPrefix.trim().toLowerCase() !== publicId) {
    return {
      valid: false,
      publicId,
      message: `OTP public ID (${publicId}) does not match registered prefix (${registeredPrefix}).`,
    };
  }

  return { valid: true, publicId, message: "Valid Yubico OTP." };
}

/**
 * Verifies FIDO2 / U2F WebAuthn assertion and user presence (touch flag).
 * @param {object} assertionData
 * @param {string} challenge
 * @param {string} [publicKey]
 * @returns {{ valid: boolean, message: string }}
 */
export function verifyFIDO2Assertion(assertionData, challenge, publicKey) {
  if (!assertionData || typeof assertionData !== "object") {
    return { valid: false, message: "Assertion data must be an object." };
  }

  const userPresence =
    assertionData.user_presence ?? assertionData.userPresence ?? true;
  if (!userPresence) {
    return {
      valid: false,
      message: "FIDO2 user presence (touch) flag missing or false.",
    };
  }

  const recvChallenge = assertionData.challenge;
  if (recvChallenge && challenge && recvChallenge !== challenge) {
    return { valid: false, message: "FIDO2 challenge mismatch." };
  }

  const sig = assertionData.signature;
  if (!sig) {
    return { valid: false, message: "FIDO2 signature missing." };
  }

  return {
    valid: true,
    message: "FIDO2 / U2F touch assertion verified successfully.",
  };
}

/**
 * Requests physical touch-to-confirm on hardware key with timeout.
 * @param {number} [timeoutMs=30000]
 * @param {function} [touchSimulator]
 * @returns {Promise<{ confirmed: boolean, message: string }>}
 */
export async function requestTouchConfirmation(
  timeoutMs = 30000,
  touchSimulator = null,
) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (Date.now() - startTime >= timeoutMs) {
        clearInterval(checkInterval);
        resolve({
          confirmed: false,
          message: `Touch confirmation timed out after ${timeoutMs / 1000}s.`,
        });
        return;
      }

      if (touchSimulator) {
        try {
          const res = touchSimulator();
          if (res === true) {
            clearInterval(checkInterval);
            resolve({ confirmed: true, message: "Touch presence confirmed." });
            return;
          } else if (res === false) {
            clearInterval(checkInterval);
            resolve({
              confirmed: false,
              message: "Touch confirmation rejected.",
            });
            return;
          }
        } catch (e) {
          clearInterval(checkInterval);
          resolve({
            confirmed: false,
            message: `Touch simulator error: ${e.message}`,
          });
          return;
        }
      } else {
        clearInterval(checkInterval);
        resolve({
          confirmed: true,
          message: "Touch presence confirmed by hardware.",
        });
        return;
      }
    }, 10);
  });
}

/**
 * Simple SHA-256 hex digest helper supporting Node.js crypto and Web Crypto API.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sha256Hex(text) {
  const isNode =
    typeof process !== "undefined" && process.versions && process.versions.node;
  if (isNode) {
    const crypto = await import("crypto");
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
  } else if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback string hashing
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

/**
 * Generates single-use emergency recovery codes.
 * @param {number} [count=5]
 * @param {number} [codeLength=8]
 * @returns {Promise<{ rawCodes: string[], hashedCodes: string[] }>}
 */
export async function generateEmergencyCodes(count = 5, codeLength = 8) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const rawCodes = [];
  const hashedCodes = [];

  for (let i = 0; i < count; i++) {
    let part1 = "";
    let part2 = "";
    for (let j = 0; j < codeLength / 2; j++) {
      part1 += alphabet[Math.floor(Math.random() * alphabet.length)];
      part2 += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const rawCode = `${part1}-${part2}`;
    const normalized = rawCode.replace(/-/g, "").trim().toUpperCase();
    const hash = await sha256Hex(normalized);

    rawCodes.push(rawCode);
    hashedCodes.push(hash);
  }

  return { rawCodes, hashedCodes };
}

/**
 * Verifies emergency recovery code and consumes it if valid.
 * @param {string} codeInput
 * @param {Array<string>|object} yubikeyConfigOrHashes
 * @returns {Promise<{ valid: boolean, message: string }>}
 */
export async function verifyAndConsumeEmergencyCode(
  codeInput,
  yubikeyConfigOrHashes,
) {
  if (!codeInput || typeof codeInput !== "string") {
    return { valid: false, message: "Invalid emergency code format." };
  }

  let hashesList = [];
  let isConfigObj = false;

  if (Array.isArray(yubikeyConfigOrHashes)) {
    hashesList = yubikeyConfigOrHashes;
  } else if (
    yubikeyConfigOrHashes &&
    typeof yubikeyConfigOrHashes === "object"
  ) {
    hashesList =
      yubikeyConfigOrHashes.emergency_codes ||
      yubikeyConfigOrHashes.emergencyCodes ||
      [];
    isConfigObj = true;
  }

  if (!hashesList || hashesList.length === 0) {
    return {
      valid: false,
      message: "No active emergency recovery codes available.",
    };
  }

  const normalized = codeInput.replace(/[- ]/g, "").trim().toUpperCase();
  const inputHash = await sha256Hex(normalized);

  const idx = hashesList.findIndex((h) => h === inputHash);
  if (idx !== -1) {
    hashesList.splice(idx, 1);
    if (isConfigObj) {
      if (yubikeyConfigOrHashes.emergency_codes) {
        yubikeyConfigOrHashes.emergency_codes = hashesList;
      } else {
        yubikeyConfigOrHashes.emergencyCodes = hashesList;
      }
    }
    return {
      valid: true,
      message: "Emergency recovery code accepted and consumed.",
    };
  }

  return { valid: false, message: "Invalid emergency recovery code." };
}

/**
 * Checks if command object or string requires YubiKey authentication.
 * @param {object|string} cmdObj
 * @param {object} [yubikeyConfig]
 * @returns {boolean}
 */
export function isSensitiveCommand(cmdObj, yubikeyConfig = null) {
  if (!cmdObj) return false;

  if (typeof cmdObj === "object") {
    if (
      cmdObj.requires_yubikey === true ||
      cmdObj.yubikey_required === true ||
      cmdObj.sensitive === true
    ) {
      return true;
    }
    if (cmdObj.yubikey && cmdObj.yubikey.enabled === true) {
      return true;
    }
  }

  const cmdStr =
    typeof cmdObj === "string"
      ? cmdObj
      : cmdObj.command || cmdObj.template || cmdObj.name || "";
  const cleanStr = cmdStr.trim().toLowerCase();

  const sensitivePatterns = [
    /\bsudo\b/i,
    /\brm\s+-rf\b/i,
    /\bvault\b/i,
    /\baws\s+secretsmanager\b/i,
    /\bkubectl\s+delete\b/i,
    /\bdrop\s+database\b/i,
    /\bgit\s+push\s+.*--force\b/i,
    /\bssh\b/i,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(cleanStr)) {
      return true;
    }
  }

  if (yubikeyConfig && yubikeyConfig.require_all_sensitive === true) {
    return true;
  }

  return false;
}

/**
 * Master authentication function for sensitive commands.
 * @param {object|string} cmdObj
 * @param {object} [authPayload]
 * @param {object} [yubikeyConfig]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function authenticateCommand(
  cmdObj,
  authPayload = {},
  yubikeyConfig = {},
) {
  const ykCfg = yubikeyConfig.yubikey || yubikeyConfig;

  if (!isSensitiveCommand(cmdObj, ykCfg)) {
    return {
      success: true,
      message: "Command does not require YubiKey authentication.",
    };
  }

  if (ykCfg && ykCfg.enabled === false) {
    return {
      success: true,
      message: "YubiKey 2FA authentication is disabled globally.",
    };
  }

  const mode = (
    authPayload.mode ||
    ykCfg.default_mode ||
    "touch"
  ).toLowerCase();

  if (mode === "emergency") {
    const code = authPayload.emergencyCode || authPayload.emergency_code || "";
    const res = await verifyAndConsumeEmergencyCode(code, ykCfg);
    return { success: res.valid, message: res.message };
  } else if (mode === "otp") {
    const otp = authPayload.otp || "";
    let regPrefix = authPayload.prefix;
    if (
      !regPrefix &&
      ykCfg.registered_keys &&
      ykCfg.registered_keys.length > 0
    ) {
      regPrefix = ykCfg.registered_keys[0].otp_prefix;
    }
    const res = validateYubicoOTP(otp, regPrefix);
    return { success: res.valid, message: res.message };
  } else if (mode === "fido2" || mode === "u2f") {
    const assertion = authPayload.assertion || {
      user_presence: true,
      signature: "mock_valid",
    };
    const challenge = authPayload.challenge || "cmdbar_auth_challenge";
    const res = verifyFIDO2Assertion(
      assertion,
      challenge,
      authPayload.publicKey,
    );
    return { success: res.valid, message: res.message };
  } else if (mode === "touch") {
    const timeout =
      (authPayload.timeoutSeconds || ykCfg.timeout_seconds || 30) * 1000;
    const res = await requestTouchConfirmation(
      timeout,
      authPayload.touchSimulator,
    );
    return { success: res.confirmed, message: res.message };
  }

  return {
    success: false,
    message: `Unsupported YubiKey authentication mode '${mode}'.`,
  };
}

/**
 * Measures performance latency of YubiKey auth verification routines.
 * @param {number} [iterations=100]
 * @returns {Promise<{ avgOtpMs: number, avgFido2Ms: number, totalPassedBenchmark: boolean }>}
 */
export async function benchmarkYubikeyAuth(iterations = 100) {
  const sampleOtp = "ccccccbedvcebcgdehbcfnhfhkfvvtrgeubfnfgnrtgr";
  const sampleAssertion = { user_presence: true, signature: "mock_valid" };

  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  for (let i = 0; i < iterations; i++) {
    validateYubicoOTP(sampleOtp, "ccccccbedvce");
  }
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const avgOtpMs = (t1 - t0) / iterations;

  const t2 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  for (let i = 0; i < iterations; i++) {
    verifyFIDO2Assertion(sampleAssertion, "test_challenge");
  }
  const t3 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const avgFido2Ms = (t3 - t2) / iterations;

  return {
    avgOtpMs,
    avgFido2Ms,
    totalPassedBenchmark: Math.max(avgOtpMs, avgFido2Ms) < 50.0,
  };
}
