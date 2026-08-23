/**
 * Policy Enforcement Engine for CmdBar extension and Node environments.
 * Handles MFA / TOTP verification for sensitive operations, Data Loss Prevention (DLP),
 * Geographic restrictions (Geo-fencing), and Time-based access controls.
 */

let cryptoModule = null;
let GLib = null;

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

if (isNode) {
  try {
    cryptoModule = await import("crypto");
  } catch (e) {}
} else {
  try {
    if (typeof globalThis.imports !== "undefined" && globalThis.imports.gi) {
      GLib = globalThis.imports.gi.GLib;
    }
  } catch (e) {}
}

export const DEFAULT_POLICY_CONFIG = {
  enabled: true,
  mfa: {
    enabled: true,
    sensitive_keywords: [
      "deploy",
      "delete",
      "destroy",
      "drop",
      "sudo",
      "prod",
      "admin",
      "kms",
      "iam",
      "secrets",
    ],
    session_ttl_seconds: 300,
    secret: "JBSWY3DPEHPK3PXP", // Default base32 test key (Secret: "Hello!")
  },
  dlp: {
    enabled: true,
    action: "block", // "block" | "redact" | "warn"
    patterns: [
      {
        name: "AWS Access Key",
        regex: "AKIA[0-9A-Z]{16}",
        category: "credentials",
      },
      {
        name: "Private Key",
        regex: "-----\\s*BEGIN[ A-Z1-9_-]*PRIVATE KEY\\s*-----",
        category: "crypto",
      },
      {
        name: "SSN",
        regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
        category: "pii",
      },
      {
        name: "Credit Card",
        regex:
          "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b",
        category: "financial",
      },
      {
        name: "Generic Secret",
        regex:
          "(?i)(api[_-]?key|secret|password|bearer\\s+[a-zA-Z0-9._-]+)\\s*[:=]\\s*['\"]?([a-zA-Z0-9._~+/-]{8,})['\"]?",
        category: "credentials",
      },
    ],
  },
  geo: {
    enabled: false,
    allowed_countries: ["US", "CA", "GB", "DE"],
    blocked_countries: [],
    allowed_ip_ranges: [],
    blocked_ip_ranges: [],
  },
  time: {
    enabled: false,
    allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    start_time: "08:00",
    end_time: "18:00",
    timezone: "UTC",
  },
};

/**
 * Decodes a Base32 string into a Uint8Array.
 * @param {string} base32Str
 * @returns {Uint8Array}
 */
export function base32ToBytes(base32Str) {
  if (!base32Str || typeof base32Str !== "string") {
    return new Uint8Array(0);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32Str.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Computes HMAC-SHA1 signature over msgBytes using keyBytes.
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} msgBytes
 * @returns {Uint8Array}
 */
function computeHmacSha1(keyBytes, msgBytes) {
  if (isNode && cryptoModule) {
    const keyBuf = Buffer.from(keyBytes);
    const msgBuf = Buffer.from(msgBytes);
    const hmac = cryptoModule.createHmac("sha1", keyBuf);
    hmac.update(msgBuf);
    return new Uint8Array(hmac.digest());
  } else if (GLib && typeof GLib.compute_hmac_for_bytes === "function") {
    const keyGBytes = new GLib.Bytes(keyBytes);
    const msgGBytes = new GLib.Bytes(msgBytes);
    const resGBytes = GLib.compute_hmac_for_bytes(
      GLib.ChecksumType.SHA1,
      keyGBytes,
      msgGBytes,
    );
    return new Uint8Array(resGBytes.toArray());
  } else {
    // Pure JS fallback HMAC-SHA1
    return pureJsHmacSha1(keyBytes, msgBytes);
  }
}

/**
 * Lightweight pure JS HMAC-SHA1 fallback implementation.
 */
function pureJsHmacSha1(keyBytes, msgBytes) {
  let key = keyBytes;
  if (key.length > 64) {
    key = sha1(key);
  }
  const paddedKey = new Uint8Array(64);
  paddedKey.set(key);

  const oPad = new Uint8Array(64);
  const iPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oPad[i] = paddedKey[i] ^ 0x5c;
    iPad[i] = paddedKey[i] ^ 0x36;
  }

  const inner = new Uint8Array(64 + msgBytes.length);
  inner.set(iPad, 0);
  inner.set(msgBytes, 64);
  const innerHash = sha1(inner);

  const outer = new Uint8Array(64 + innerHash.length);
  outer.set(oPad, 0);
  outer.set(innerHash, 64);
  return sha1(outer);
}

function sha1(bytes) {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const len = bytes.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen & 0xffffffff, false);
  const highBitLen = Math.floor(bitLen / 0x100000000);
  view.setUint32(paddedLen - 8, highBitLen, false);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const temp = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (temp << 1) | (temp >>> 31);
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) & 0xffffffff;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) & 0xffffffff;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) & 0xffffffff;
    h1 = (h1 + b) & 0xffffffff;
    h2 = (h2 + c) & 0xffffffff;
    h3 = (h3 + d) & 0xffffffff;
    h4 = (h4 + e) & 0xffffffff;
  }

  const result = new Uint8Array(20);
  const resView = new DataView(result.buffer);
  resView.setUint32(0, h0, false);
  resView.setUint32(4, h1, false);
  resView.setUint32(8, h2, false);
  resView.setUint32(12, h3, false);
  resView.setUint32(16, h4, false);
  return result;
}

/**
 * Generates an RFC 6238 TOTP code given a base32/string secret.
 * @param {string} secret
 * @param {number} [timestamp]
 * @param {number} [digits=6]
 * @param {number} [step=30]
 * @returns {string}
 */
export function generateTOTP(secret, timestamp = null, digits = 6, step = 30) {
  if (!secret) return "";
  const ts =
    timestamp !== null && timestamp !== undefined
      ? timestamp
      : Math.floor(Date.now() / 1000);
  const counter = Math.floor(ts / step);

  let keyBytes = base32ToBytes(secret);
  if (keyBytes.length === 0) {
    if (typeof TextEncoder !== "undefined") {
      keyBytes = new TextEncoder().encode(secret);
    } else {
      keyBytes = new Uint8Array(Array.from(secret).map((c) => c.charCodeAt(0)));
    }
  }

  const msgBytes = new Uint8Array(8);
  let tmpCounter = counter;
  for (let i = 7; i >= 0; i--) {
    msgBytes[i] = tmpCounter & 0xff;
    tmpCounter = Math.floor(tmpCounter / 256);
  }

  const hmacBytes = computeHmacSha1(keyBytes, msgBytes);
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binaryCode =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = binaryCode % Math.pow(10, digits);
  return String(otp).padStart(digits, "0");
}

/**
 * Verifies a TOTP token against a secret with window allowance.
 * @param {string|number} token
 * @param {string} secret
 * @param {number} [window=1]
 * @param {number} [timestamp]
 * @returns {boolean}
 */
export function verifyTOTP(token, secret, window = 1, timestamp = null) {
  if (token === null || token === undefined || !secret) return false;
  const tokenStr = String(token).trim();
  if (!tokenStr) return false;

  const ts =
    timestamp !== null && timestamp !== undefined
      ? timestamp
      : Math.floor(Date.now() / 1000);
  const step = 30;

  for (let w = -window; w <= window; w++) {
    const testTime = ts + w * step;
    if (generateTOTP(secret, testTime) === tokenStr) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a command or command object is sensitive and requires MFA.
 * @param {object|string} commandObjOrStr
 * @param {string[]} [sensitiveKeywords]
 * @returns {boolean}
 */
export function isSensitiveCommand(commandObjOrStr, sensitiveKeywords = null) {
  if (!commandObjOrStr) return false;

  const keywords =
    sensitiveKeywords && Array.isArray(sensitiveKeywords)
      ? sensitiveKeywords
      : DEFAULT_POLICY_CONFIG.mfa.sensitive_keywords;

  if (typeof commandObjOrStr === "object") {
    if (
      commandObjOrStr.sensitive === true ||
      commandObjOrStr.mfa_required === true
    ) {
      return true;
    }
    if (
      commandObjOrStr.sensitivity_level === "high" ||
      commandObjOrStr.sensitivity_level === "critical"
    ) {
      return true;
    }
  }

  const fullStr =
    typeof commandObjOrStr === "string"
      ? commandObjOrStr
      : `${commandObjOrStr.name || ""} ${commandObjOrStr.command || commandObjOrStr.template || ""}`;

  const lowerStr = fullStr.toLowerCase();
  for (const kw of keywords) {
    if (kw && kw.trim()) {
      const regex = new RegExp(`\\b${kw.trim()}\\b`, "i");
      if (regex.test(lowerStr)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Helper to convert IPv4 string to 32-bit unsigned integer.
 */
function ipToLong(ipStr) {
  if (!ipStr || typeof ipStr !== "string") return 0;
  const parts = ipStr.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return 0;
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

/**
 * Checks if an IP address falls within a CIDR range or matches an exact IP.
 * @param {string} ipStr
 * @param {string} cidrStr
 * @returns {boolean}
 */
export function ipInRange(ipStr, cidrStr) {
  if (!ipStr || !cidrStr) return false;
  const cleanIp = ipStr.trim();
  const cleanCidr = cidrStr.trim();

  if (cleanIp === cleanCidr) return true;
  if (!cleanCidr.includes("/")) return cleanIp === cleanCidr;

  const [netIp, prefixStr] = cleanCidr.split("/");
  const prefixLen = parseInt(prefixStr, 10);
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;

  const ipLong = ipToLong(cleanIp);
  const netLong = ipToLong(netIp);
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;

  return (ipLong & mask) === (netLong & mask);
}

/**
 * Evaluates Geographic restrictions against user context.
 * @param {object} context
 * @param {object} geoPolicy
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkGeo(context, geoPolicy) {
  if (!geoPolicy || geoPolicy.enabled === false) {
    return { allowed: true };
  }

  const ctx = context || {};
  const ip = ctx.ip_address || ctx.ip || "";
  const country = (ctx.country_code || ctx.country || "").toUpperCase();

  const allowedCountries = (geoPolicy.allowed_countries || []).map((c) =>
    c.toUpperCase(),
  );
  const blockedCountries = (geoPolicy.blocked_countries || []).map((c) =>
    c.toUpperCase(),
  );
  const allowedIpRanges = geoPolicy.allowed_ip_ranges || [];
  const blockedIpRanges = geoPolicy.blocked_ip_ranges || [];

  if (
    blockedCountries.length > 0 &&
    country &&
    blockedCountries.includes(country)
  ) {
    return {
      allowed: false,
      reason: `Country '${country}' is explicitly blocked by geographic policy.`,
    };
  }

  if (allowedCountries.length > 0 && country) {
    if (!allowedCountries.includes(country)) {
      return {
        allowed: false,
        reason: `Country '${country}' is not in allowed geographic regions list.`,
      };
    }
  }

  if (ip && blockedIpRanges.length > 0) {
    for (const range of blockedIpRanges) {
      if (ipInRange(ip, range)) {
        return {
          allowed: false,
          reason: `IP address '${ip}' is blocked by IP range policy (${range}).`,
        };
      }
    }
  }

  if (ip && allowedIpRanges.length > 0) {
    let inAllowed = false;
    for (const range of allowedIpRanges) {
      if (ipInRange(ip, range)) {
        inAllowed = true;
        break;
      }
    }
    if (!inAllowed) {
      return {
        allowed: false,
        reason: `IP address '${ip}' is not in allowed IP ranges list.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Evaluates Time-based access controls against user context.
 * @param {object} context
 * @param {object} timePolicy
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkTime(context, timePolicy) {
  if (!timePolicy || timePolicy.enabled === false) {
    return { allowed: true };
  }

  const ctx = context || {};
  const dateObj = ctx.timestamp ? new Date(ctx.timestamp) : new Date();

  const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const currentDayName = daysMap[dateObj.getUTCDay()];
  const currentDayIdx = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon ...

  const allowedDays = timePolicy.allowed_days || [];
  if (allowedDays.length > 0) {
    const isAllowedDay = allowedDays.some((d) => {
      if (typeof d === "number") return d === currentDayIdx;
      if (typeof d === "string") {
        return d.toLowerCase().slice(0, 3) === currentDayName.toLowerCase();
      }
      return false;
    });

    if (!isAllowedDay) {
      return {
        allowed: false,
        reason: `Access denied on ${currentDayName} (allowed days: ${allowedDays.join(", ")}).`,
      };
    }
  }

  const startTimeStr = timePolicy.start_time;
  const endTimeStr = timePolicy.end_time;

  if (startTimeStr && endTimeStr) {
    const parseMinutes = (tStr) => {
      const parts = tStr.split(":").map((p) => parseInt(p, 10));
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    };

    const startMin = parseMinutes(startTimeStr);
    const endMin = parseMinutes(endTimeStr);
    const currentMin = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();

    if (startMin <= endMin) {
      if (currentMin < startMin || currentMin > endMin) {
        return {
          allowed: false,
          reason: `Access denied at current time (${dateObj.toISOString().slice(11, 16)} UTC). Allowed window: ${startTimeStr} - ${endTimeStr}.`,
        };
      }
    } else {
      // Overnight window (e.g. 22:00 to 06:00)
      if (currentMin < startMin && currentMin > endMin) {
        return {
          allowed: false,
          reason: `Access denied at current time (${dateObj.toISOString().slice(11, 16)} UTC). Allowed overnight window: ${startTimeStr} - ${endTimeStr}.`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Scans text for DLP pattern violations.
 * @param {string} text
 * @param {object} dlpPolicy
 * @returns {Array<{ name: string, category: string, match: string }>}
 */
export function checkDLP(text, dlpPolicy) {
  if (
    !text ||
    typeof text !== "string" ||
    !dlpPolicy ||
    dlpPolicy.enabled === false
  ) {
    return [];
  }

  const patterns = dlpPolicy.patterns || DEFAULT_POLICY_CONFIG.dlp.patterns;
  const violations = [];

  for (const pat of patterns) {
    if (!pat || !pat.regex) continue;
    try {
      let flags = "g";
      let regexStr = pat.regex;
      if (regexStr.startsWith("(?i)")) {
        flags += "i";
        regexStr = regexStr.slice(4);
      }

      const regex = new RegExp(regexStr, flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        violations.push({
          name: pat.name || "Sensitive Data",
          category: pat.category || "dlp",
          match: match[0],
        });
      }
    } catch (e) {
      // Ignore invalid regex in policy definition
    }
  }

  return violations;
}

/**
 * Redacts sensitive DLP patterns in text.
 * @param {string} text
 * @param {object} dlpPolicy
 * @returns {string}
 */
export function redactDLP(text, dlpPolicy) {
  if (!text || typeof text !== "string") return "";
  if (!dlpPolicy || dlpPolicy.enabled === false) return text;

  const patterns = dlpPolicy.patterns || DEFAULT_POLICY_CONFIG.dlp.patterns;
  let redacted = text;

  for (const pat of patterns) {
    if (!pat || !pat.regex) continue;
    try {
      let flags = "g";
      let regexStr = pat.regex;
      if (regexStr.startsWith("(?i)")) {
        flags += "i";
        regexStr = regexStr.slice(4);
      }

      const regex = new RegExp(regexStr, flags);
      const replacement = `[REDACTED_${(pat.category || "DATA").toUpperCase()}]`;
      redacted = redacted.replace(regex, replacement);
    } catch (e) {}
  }

  return redacted;
}

/**
 * Evaluates full Security Policy for a command execution.
 * Order of evaluation: Time -> Geo -> DLP -> MFA.
 * @param {object|string} commandObjOrStr
 * @param {object} [params={}]
 * @param {object} [context={}]
 * @param {object} [policyConfig]
 * @returns {object} Evaluation result object
 */
export function evaluatePolicy(
  commandObjOrStr,
  params = {},
  context = {},
  policyConfig = null,
) {
  const policy = policyConfig || DEFAULT_POLICY_CONFIG;
  const ctx = context || {};
  const cmdObj =
    typeof commandObjOrStr === "string"
      ? { command: commandObjOrStr, name: commandObjOrStr }
      : commandObjOrStr || { command: "", name: "" };

  const rawCmdStr = cmdObj.command || cmdObj.template || "";
  const paramValues = params && typeof params === "object" ? params : {};
  const paramStr = Object.values(paramValues).join(" ");
  const fullTextToScan = `${cmdObj.name || ""} ${rawCmdStr} ${paramStr}`.trim();

  const reasons = [];
  const dlpViolations = [];

  if (policy.enabled === false) {
    return {
      allowed: true,
      action: "allow",
      reasons: ["Policy enforcement is globally disabled."],
      mfa_required: false,
      mfa_verified: false,
      dlp_violations: [],
      sanitized_command: rawCmdStr,
      sanitized_params: { ...paramValues },
      evaluated_at: new Date().toISOString(),
    };
  }

  // 1. Time Policy Check
  const timeRes = checkTime(ctx, policy.time);
  if (!timeRes.allowed) {
    return {
      allowed: false,
      action: "block",
      reasons: [timeRes.reason || "Time-based policy restriction violation."],
      mfa_required: false,
      mfa_verified: false,
      dlp_violations: [],
      sanitized_command: rawCmdStr,
      sanitized_params: { ...paramValues },
      evaluated_at: new Date().toISOString(),
    };
  }

  // 2. Geo Policy Check
  const geoRes = checkGeo(ctx, policy.geo);
  if (!geoRes.allowed) {
    return {
      allowed: false,
      action: "block",
      reasons: [geoRes.reason || "Geographic policy restriction violation."],
      mfa_required: false,
      mfa_verified: false,
      dlp_violations: [],
      sanitized_command: rawCmdStr,
      sanitized_params: { ...paramValues },
      evaluated_at: new Date().toISOString(),
    };
  }

  // 3. DLP Policy Check
  let sanitizedCmd = rawCmdStr;
  const sanitizedParams = { ...paramValues };

  if (policy.dlp && policy.dlp.enabled !== false) {
    const foundViolations = checkDLP(fullTextToScan, policy.dlp);
    if (foundViolations.length > 0) {
      dlpViolations.push(...foundViolations);
      const action = policy.dlp.action || "block";

      if (action === "block") {
        return {
          allowed: false,
          action: "block",
          reasons: [
            `Data Loss Prevention (DLP) violation: ${foundViolations
              .map((v) => v.name)
              .join(", ")} detected.`,
          ],
          mfa_required: false,
          mfa_verified: false,
          dlp_violations: foundViolations,
          sanitized_command: rawCmdStr,
          sanitized_params: { ...paramValues },
          evaluated_at: new Date().toISOString(),
        };
      } else if (action === "redact") {
        sanitizedCmd = redactDLP(rawCmdStr, policy.dlp);
        for (const [k, v] of Object.entries(sanitizedParams)) {
          sanitizedParams[k] = redactDLP(String(v), policy.dlp);
        }
        reasons.push(
          `DLP policy automatically redacted sensitive content (${foundViolations.length} items).`,
        );
      } else if (action === "warn") {
        reasons.push(
          `DLP warning: sensitive content detected (${foundViolations
            .map((v) => v.name)
            .join(", ")}).`,
        );
      }
    }
  }

  // 4. Sensitivity & MFA Check
  let mfaRequired = false;
  let mfaVerified = false;

  if (policy.mfa && policy.mfa.enabled !== false) {
    mfaRequired = isSensitiveCommand(cmdObj, policy.mfa.sensitive_keywords);

    if (mfaRequired) {
      const token = ctx.mfa_token || paramValues.mfa_token || null;
      const sessionToken = ctx.session_token || null;
      const secret = policy.mfa.secret || DEFAULT_POLICY_CONFIG.mfa.secret;

      if (sessionToken && ctx.session_valid === true) {
        mfaVerified = true;
        reasons.push("MFA verified via active session.");
      } else if (token && verifyTOTP(token, secret)) {
        mfaVerified = true;
        reasons.push("MFA verified via TOTP code.");
      } else {
        return {
          allowed: false,
          action: "mfa_required",
          reasons: [
            "Operation is classified as sensitive and requires Multi-Factor Authentication (MFA).",
          ],
          mfa_required: true,
          mfa_verified: false,
          dlp_violations: dlpViolations,
          sanitized_command: sanitizedCmd,
          sanitized_params: sanitizedParams,
          evaluated_at: new Date().toISOString(),
        };
      }
    }
  }

  if (reasons.length === 0) {
    reasons.push("Policy evaluation passed successfully.");
  }

  return {
    allowed: true,
    action:
      dlpViolations.length > 0 && policy.dlp?.action === "redact"
        ? "redact"
        : "allow",
    reasons,
    mfa_required: mfaRequired,
    mfa_verified: mfaVerified,
    dlp_violations: dlpViolations,
    sanitized_command: sanitizedCmd,
    sanitized_params: sanitizedParams,
    evaluated_at: new Date().toISOString(),
  };
}
