/**
 * Command Security Policy Engine for CmdBar.
 * Provides blacklist command blocking, whitelist enforcement, wildcard/glob/regex pattern matching,
 * user/group scoped policy rules, and approval override mechanisms.
 *
 * Runs in both Node.js (testing/companion) and GJS (GNOME Shell) environments.
 */

import os from "os";

/**
 * Default global dangerous command patterns to block by default when policy is active.
 */
export const DEFAULT_BLACKLIST_PATTERNS = [
  "rm -rf *",
  "rm -rf /",
  "mkfs*",
  "dd if=*",
  ":(){ :|:& };:",
  "chmod -R 777 *",
  "shutdown*",
  "reboot*",
  "> /dev/sd*",
  "wget * | sh",
  "curl * | sh",
  "wget * | bash",
  "curl * | bash",
];

/**
 * Standard required system command whitelist patterns.
 */
export const DEFAULT_WHITELIST_PATTERNS = [
  "echo *",
  "make *",
  "git *",
  "aws *",
  "ping *",
  "docker *",
  "python*",
  "node *",
  "npm *",
  "notify-send *",
  "deploy *",
  "pkill *",
  "zenity *",
];

/**
 * Converts a glob pattern containing '*' and '?' into a regular expression.
 * @param {string} pattern
 * @returns {RegExp}
 * @public
 */
export function globToRegex(pattern) {
  if (typeof pattern !== "string") {
    return /^$/;
  }
  const str = pattern.trim();
  let regexStr = "";
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c === "*") {
      regexStr += ".*";
    } else if (c === "?") {
      regexStr += ".";
    } else if ("\\^$.|()[]{}+".includes(c)) {
      regexStr += "\\" + c;
    } else {
      regexStr += c;
    }
    i++;
  }
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Evaluates whether a target command string matches a policy pattern.
 * Supports exact match, globs (* and ?), regex strings ("regex:..."), or RegExp objects.
 * @param {string} commandStr
 * @param {string|RegExp} pattern
 * @returns {boolean}
 * @public
 */
export function matchPattern(commandStr, pattern) {
  if (commandStr === null || commandStr === undefined) return false;
  if (!pattern) return false;

  const cleanCmd = String(commandStr).trim();

  // 1. RegExp instance
  if (pattern instanceof RegExp) {
    return pattern.test(cleanCmd);
  }

  const strPattern = String(pattern).trim();
  if (!strPattern) return false;

  // 2. Explicit Regex Prefix ("regex:...")
  if (strPattern.startsWith("regex:")) {
    const rawRegex = strPattern.slice(6).trim();
    try {
      const rx = new RegExp(rawRegex, "i");
      return rx.test(cleanCmd);
    } catch (e) {
      return false;
    }
  }

  // 3. Exact Match
  if (cleanCmd.toLowerCase() === strPattern.toLowerCase()) {
    return true;
  }

  // 4. Glob / Wildcard Match
  if (strPattern.includes("*") || strPattern.includes("?")) {
    const rx = globToRegex(strPattern);
    return rx.test(cleanCmd);
  }

  // 5. Prefix / Binary Match fallback (e.g. pattern "rm" matches "rm -rf /")
  const cmdTokens = cleanCmd.split(/\s+/);
  const firstToken = cmdTokens[0] || "";
  const patternTokens = strPattern.split(/\s+/);

  if (patternTokens.length === 1) {
    // If pattern is a single word like "rm" or "shutdown", check binary name match or command start
    if (firstToken.toLowerCase() === strPattern.toLowerCase() ||
        firstToken.toLowerCase().endsWith("/" + strPattern.toLowerCase())) {
      return true;
    }
  }

  // Substring prefix check for multi-word non-glob pattern
  if (cleanCmd.toLowerCase().startsWith(strPattern.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Resolves current system user and group context.
 * @param {object} [customContext]
 * @returns {{ user: string, group: string, groups: string[] }}
 * @public
 */
export function resolveUserContext(customContext = {}) {
  let user = customContext.user || customContext.username;
  let group = customContext.group;
  let groups = Array.isArray(customContext.groups) ? [...customContext.groups] : [];

  if (!user) {
    try {
      if (typeof process !== "undefined" && process.env) {
        user = process.env.USER || process.env.LOGNAME || process.env.USERNAME;
      }
      if (!user && os && typeof os.userInfo === "function") {
        const info = os.userInfo();
        user = info.username;
      }
    } catch (e) {
      user = "unknown";
    }
  }

  if (!user) {
    user = "unknown";
  }

  if (!group) {
    group = customContext.role || "users";
  }

  if (!groups.includes(group)) {
    groups.push(group);
  }

  return {
    user: String(user).toLowerCase(),
    group: String(group).toLowerCase(),
    groups: groups.map((g) => String(g).toLowerCase()),
  };
}

/**
 * Evaluates a command string against a security policy and user context.
 *
 * @param {string} commandStr
 * @param {object} [customContext]
 * @param {object} [policyConfig]
 * @param {string} [approvalToken]
 * @returns {{ allowed: boolean, reason: string, blockedBy: string|null, rule: object|null, pattern: string|null, approved: boolean }}
 * @public
 */
export function evaluateCommandPolicy(
  commandStr,
  customContext = {},
  policyConfig = null,
  approvalToken = null
) {
  if (!commandStr || typeof commandStr !== "string" || commandStr.trim() === "") {
    return {
      allowed: false,
      reason: "Empty or invalid command string",
      blockedBy: "validation",
      rule: null,
      pattern: null,
      approved: false,
    };
  }

  const cleanCmd = commandStr.trim();
  const context = resolveUserContext(customContext);

  // Default policy configuration if none supplied
  const policy = policyConfig || {
    enabled: true,
    mode: "blacklist", // "blacklist", "whitelist", or "combined"
    blacklist: DEFAULT_BLACKLIST_PATTERNS,
    whitelist: [],
    rules: [],
    overrides: [],
  };

  if (policy.enabled === false) {
    return {
      allowed: true,
      reason: "Security policy is disabled",
      blockedBy: null,
      rule: null,
      pattern: null,
      approved: false,
    };
  }

  // 1. Check if an active override or approval token covers this command
  if (approvalToken && Array.isArray(policy.overrides)) {
    const activeOverride = policy.overrides.find(
      (ov) =>
        ov.token === approvalToken &&
        (ov.command === "*" || matchPattern(cleanCmd, ov.command)) &&
        (!ov.expiresAt || ov.expiresAt > Date.now())
    );

    if (activeOverride) {
      return {
        allowed: true,
        reason: `Allowed via active approval override (Token: ${approvalToken})`,
        blockedBy: null,
        rule: null,
        pattern: activeOverride.command,
        approved: true,
      };
    }
  }

  // Also check inline overrides matching command string without token if explicitly approved
  if (Array.isArray(policy.overrides)) {
    const directOverride = policy.overrides.find(
      (ov) =>
        ov.approved === true &&
        matchPattern(cleanCmd, ov.command) &&
        (!ov.expiresAt || ov.expiresAt > Date.now())
    );

    if (directOverride) {
      return {
        allowed: true,
        reason: `Allowed via direct approved command override for '${directOverride.command}'`,
        blockedBy: null,
        rule: null,
        pattern: directOverride.command,
        approved: true,
      };
    }
  }

  // 2. User / Group Specific Rules
  if (Array.isArray(policy.rules) && policy.rules.length > 0) {
    for (const rule of policy.rules) {
      if (!rule || !rule.pattern) continue;

      // Check if rule applies to user
      let userMatches = false;
      if (rule.user) {
        userMatches = String(rule.user).toLowerCase() === context.user;
      } else if (Array.isArray(rule.users)) {
        userMatches = rule.users.map((u) => String(u).toLowerCase()).includes(context.user);
      } else {
        userMatches = true; // Rule applies to all users if user filter omitted
      }

      // Check if rule applies to group
      let groupMatches = false;
      if (rule.group) {
        groupMatches = context.groups.includes(String(rule.group).toLowerCase());
      } else if (Array.isArray(rule.groups)) {
        groupMatches = rule.groups.some((g) => context.groups.includes(String(g).toLowerCase()));
      } else {
        groupMatches = true; // Rule applies to all groups if group filter omitted
      }

      if (userMatches && groupMatches) {
        if (matchPattern(cleanCmd, rule.pattern)) {
          const action = String(rule.action || "deny").toLowerCase();
          if (action === "deny" || action === "block") {
            return {
              allowed: false,
              reason: rule.reason || `Blocked by user/group policy rule (${rule.id || rule.pattern})`,
              blockedBy: "user_group_rule",
              rule: rule,
              pattern: rule.pattern,
              approved: false,
            };
          } else if (action === "allow" || action === "permit") {
            return {
              allowed: true,
              reason: rule.reason || `Allowed by user/group policy rule (${rule.id || rule.pattern})`,
              blockedBy: null,
              rule: rule,
              pattern: rule.pattern,
              approved: false,
            };
          }
        }
      }
    }
  }

  const mode = String(policy.mode || "blacklist").toLowerCase();

  // 3. Blacklist Evaluation
  const blacklist = Array.isArray(policy.blacklist) ? policy.blacklist : DEFAULT_BLACKLIST_PATTERNS;
  if (mode === "blacklist" || mode === "combined") {
    for (const pattern of blacklist) {
      if (matchPattern(cleanCmd, pattern)) {
        return {
          allowed: false,
          reason: `Blocked by dangerous command blacklist pattern: '${pattern}'`,
          blockedBy: "blacklist",
          rule: null,
          pattern: String(pattern),
          approved: false,
        };
      }
    }
  }

  // 4. Whitelist Evaluation
  const whitelist = Array.isArray(policy.whitelist) ? policy.whitelist : [];
  if (mode === "whitelist" || (mode === "combined" && whitelist.length > 0)) {
    let matchedWhitelist = false;
    for (const pattern of whitelist) {
      if (matchPattern(cleanCmd, pattern)) {
        matchedWhitelist = true;
        break;
      }
    }

    if (!matchedWhitelist) {
      return {
        allowed: false,
        reason: `Command is not present in required command whitelist`,
        blockedBy: "whitelist",
        rule: null,
        pattern: null,
        approved: false,
      };
    }
  }

  return {
    allowed: true,
    reason: "Command security policy check passed successfully",
    blockedBy: null,
    rule: null,
    pattern: null,
    approved: false,
  };
}

/**
 * Command Security Policy Manager class.
 * Handles policy state, approval workflows, and command override tokens.
 */
export class CommandPolicyManager {
  /**
   * @param {object} [initialPolicy]
   */
  constructor(initialPolicy = null) {
    this.policy = initialPolicy || {
      enabled: true,
      mode: "blacklist",
      blacklist: [...DEFAULT_BLACKLIST_PATTERNS],
      whitelist: [...DEFAULT_WHITELIST_PATTERNS],
      rules: [],
      overrides: [],
    };

    this.pendingApprovals = new Map();
  }

  /**
   * Updates policy configuration.
   * @param {object} policyConfig
   * @public
   */
  setPolicy(policyConfig) {
    if (!policyConfig || typeof policyConfig !== "object") return;
    this.policy = {
      enabled: policyConfig.enabled !== false,
      mode: policyConfig.mode || "blacklist",
      blacklist: Array.isArray(policyConfig.blacklist)
        ? [...policyConfig.blacklist]
        : [...DEFAULT_BLACKLIST_PATTERNS],
      whitelist: Array.isArray(policyConfig.whitelist)
        ? [...policyConfig.whitelist]
        : [...DEFAULT_WHITELIST_PATTERNS],
      rules: Array.isArray(policyConfig.rules) ? [...policyConfig.rules] : [],
      overrides: Array.isArray(policyConfig.overrides) ? [...policyConfig.overrides] : [],
    };
  }

  /**
   * Returns current policy.
   * @returns {object}
   * @public
   */
  getPolicy() {
    return JSON.parse(JSON.stringify(this.policy));
  }

  /**
   * Evaluates command against active policy.
   * @param {string} commandStr
   * @param {object} [context]
   * @param {string} [approvalToken]
   * @returns {object}
   * @public
   */
  evaluate(commandStr, context = {}, approvalToken = null) {
    return evaluateCommandPolicy(commandStr, context, this.policy, approvalToken);
  }

  /**
   * Creates an approval request for a blocked or restricted command.
   * @param {string} commandStr
   * @param {object} [requesterContext]
   * @param {string} [reason]
   * @returns {{ id: string, command: string, user: string, status: string, createdAt: number, reason: string }}
   * @public
   */
  requestApproval(commandStr, requesterContext = {}, reason = "") {
    const ctx = resolveUserContext(requesterContext);
    const id = `req_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const request = {
      id,
      command: commandStr,
      user: ctx.user,
      groups: ctx.groups,
      reason: reason || "Requested command override approval",
      status: "pending",
      createdAt: Date.now(),
      approvedBy: null,
      token: null,
    };

    this.pendingApprovals.set(id, request);
    return { ...request };
  }

  /**
   * Approves a pending approval request and generates an override token.
   * @param {string} requestId
   * @param {object} [approverContext]
   * @param {number} [ttlMs=3600000] Default TTL 1 hour
   * @returns {{ id: string, token: string, status: string, approvedBy: string, expiresAt: number }}
   * @public
   */
  approveRequest(requestId, approverContext = {}, ttlMs = 3600000) {
    const req = this.pendingApprovals.get(requestId);
    if (!req) {
      throw new Error(`Approval request ID '${requestId}' not found`);
    }

    const approver = resolveUserContext(approverContext);
    const token = `token_appr_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const expiresAt = Date.now() + ttlMs;

    req.status = "approved";
    req.approvedBy = approver.user;
    req.token = token;
    req.expiresAt = expiresAt;

    const override = {
      id: `ovr_${requestId}`,
      command: req.command,
      token,
      approved: true,
      approvedBy: approver.user,
      expiresAt,
    };

    if (!Array.isArray(this.policy.overrides)) {
      this.policy.overrides = [];
    }
    this.policy.overrides.push(override);

    return { ...req };
  }

  /**
   * Rejects a pending approval request.
   * @param {string} requestId
   * @param {object} [approverContext]
   * @param {string} [rejectReason]
   * @returns {object}
   * @public
   */
  rejectRequest(requestId, approverContext = {}, rejectReason = "") {
    const req = this.pendingApprovals.get(requestId);
    if (!req) {
      throw new Error(`Approval request ID '${requestId}' not found`);
    }

    const approver = resolveUserContext(approverContext);
    req.status = "rejected";
    req.approvedBy = approver.user;
    req.rejectReason = rejectReason || "Approval request denied by policy administrator";

    return { ...req };
  }

  /**
   * Grants a direct override for a command pattern.
   * @param {string} commandPattern
   * @param {object} [approverContext]
   * @param {number} [ttlMs=3600000]
   * @returns {{ token: string, command: string, expiresAt: number }}
   * @public
   */
  grantOverride(commandPattern, approverContext = {}, ttlMs = 3600000) {
    const approver = resolveUserContext(approverContext);
    const token = `token_dir_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const expiresAt = Date.now() + ttlMs;

    const override = {
      id: `ovr_dir_${Date.now()}`,
      command: commandPattern,
      token,
      approved: true,
      approvedBy: approver.user,
      expiresAt,
    };

    if (!Array.isArray(this.policy.overrides)) {
      this.policy.overrides = [];
    }
    this.policy.overrides.push(override);

    return { token, command: commandPattern, expiresAt };
  }

  /**
   * Revokes an override token or ID.
   * @param {string} tokenOrId
   * @returns {boolean}
   * @public
   */
  revokeOverride(tokenOrId) {
    if (!Array.isArray(this.policy.overrides)) return false;
    const initialLen = this.policy.overrides.length;
    this.policy.overrides = this.policy.overrides.filter(
      (ov) => ov.token !== tokenOrId && ov.id !== tokenOrId
    );
    return this.policy.overrides.length < initialLen;
  }

  /**
   * Lists all pending approval requests.
   * @returns {Array<object>}
   * @public
   */
  listPendingApprovals() {
    return Array.from(this.pendingApprovals.values()).filter(
      (r) => r.status === "pending"
    );
  }

  /**
   * Lists active non-expired overrides.
   * @returns {Array<object>}
   * @public
   */
  listOverrides() {
    if (!Array.isArray(this.policy.overrides)) return [];
    const now = Date.now();
    return this.policy.overrides.filter((ov) => !ov.expiresAt || ov.expiresAt > now);
  }
}
