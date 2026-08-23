/**
 * Role-Based Access Control (RBAC) Module for CmdBar.
 * Provides granular permissions, role management, command visibility rules,
 * approval chains, delegation, and structured audit logging.
 */

export const DEFAULT_PERMISSIONS = {
  COMMANDS_VIEW: "commands:view",
  COMMANDS_EXECUTE: "commands:execute",
  COMMANDS_APPROVE: "commands:approve",
  COMMANDS_MANAGE: "commands:manage",
  RBAC_MANAGE: "rbac:manage",
  AUDIT_VIEW: "audit:view",
  ALL: "*",
};

export const DEFAULT_ROLES = {
  admin: {
    name: "Admin",
    description: "Administrator with full access",
    permissions: ["*"],
  },
  operator: {
    name: "Operator",
    description: "Operator with command execution and approval access",
    permissions: ["commands:view", "commands:execute", "commands:approve"],
  },
  user: {
    name: "User",
    description: "Standard user with command execution access",
    permissions: ["commands:view", "commands:execute"],
  },
  viewer: {
    name: "Viewer",
    description: "Read-only access to view commands",
    permissions: ["commands:view"],
  },
  auditor: {
    name: "Auditor",
    description: "Access to view commands and audit trail",
    permissions: ["commands:view", "audit:view"],
  },
};

/**
 * Checks if a set of granted permissions satisfies a required permission.
 * Handles exact matches, superuser wildcard '*', and namespace wildcards (e.g. 'commands:*').
 *
 * @param {string[]} granted
 * @param {string|string[]} required
 * @returns {boolean}
 */
export function hasPermission(granted, required) {
  if (!granted || !Array.isArray(granted)) return false;
  if (!required) return true;

  if (granted.includes("*")) return true;

  const reqList = Array.isArray(required) ? required : [required];
  if (reqList.length === 0) return true;

  return reqList.every((req) => {
    if (!req) return true;
    if (granted.includes(req)) return true;

    // Check namespace wildcard match (e.g. granted 'commands:*' matches required 'commands:view')
    return granted.some((g) => {
      if (typeof g !== "string") return false;
      if (g.endsWith(":*")) {
        const prefix = g.slice(0, -1); // e.g. 'commands:'
        return req.startsWith(prefix);
      }
      return false;
    });
  });
}

/**
 * AuditLogger for tracking security and authorization events.
 */
export class AuditLogger {
  constructor(options = {}) {
    this.logs = options.logs || [];
    this.maxLogs = options.maxLogs || 1000;
  }

  log(actor, role, action, target, result, details = {}) {
    const entry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      actor: actor || "anonymous",
      role: role || "unknown",
      action: action || "UNKNOWN_ACTION",
      target: target || "system",
      result: result || "UNKNOWN",
      details: details || {},
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    return entry;
  }

  getLogs(filter = {}) {
    let filtered = [...this.logs];
    if (filter.actor) {
      const a = filter.actor.toLowerCase();
      filtered = filtered.filter((l) => (l.actor || "").toLowerCase() === a);
    }
    if (filter.action) {
      const act = filter.action.toUpperCase();
      filtered = filtered.filter((l) => (l.action || "").toUpperCase() === act);
    }
    if (filter.target) {
      const t = filter.target.toLowerCase();
      filtered = filtered.filter((l) => (l.target || "").toLowerCase() === t);
    }
    if (filter.result) {
      const r = filter.result.toUpperCase();
      filtered = filtered.filter((l) => (l.result || "").toUpperCase() === r);
    }
    if (filter.since) {
      const sinceTime = new Date(filter.since).getTime();
      filtered = filtered.filter((l) => new Date(l.timestamp).getTime() >= sinceTime);
    }
    if (filter.until) {
      const untilTime = new Date(filter.until).getTime();
      filtered = filtered.filter((l) => new Date(l.timestamp).getTime() <= untilTime);
    }
    if (filter.limit && typeof filter.limit === "number") {
      filtered = filtered.slice(0, filter.limit);
    }
    return filtered;
  }

  clear() {
    this.logs = [];
  }
}

/**
 * Main Role-Based Access Control (RBAC) Manager.
 */
export class RBACManager {
  constructor(config = {}) {
    this.enabled = config.enabled !== undefined ? Boolean(config.enabled) : true;
    this.defaultRole = config.default_role || "user";
    this.roles = { ...DEFAULT_ROLES, ...(config.roles || {}) };
    this.users = config.users || {};
    this.delegations = config.delegations || [];
    this.approvalRequests = config.approval_requests || [];
    this.auditLogger = new AuditLogger({ logs: config.audit_logs || [] });
  }

  /**
   * Returns state exportable to JSON / config storage.
   */
  toJSON() {
    return {
      enabled: this.enabled,
      default_role: this.defaultRole,
      roles: this.roles,
      users: this.users,
      delegations: this.delegations,
      approval_requests: this.approvalRequests,
      audit_logs: this.auditLogger.logs,
    };
  }

  /**
   * User role management.
   */
  getUserRole(username) {
    if (!username) return this.defaultRole;
    const userData = this.users[username];
    if (userData && userData.role) {
      return userData.role;
    }
    return this.defaultRole;
  }

  setUserRole(username, role, actor = "admin") {
    if (!username || typeof username !== "string") return false;
    if (!this.roles[role]) {
      throw new Error(`Role '${role}' does not exist.`);
    }
    const previousRole = this.getUserRole(username);
    if (!this.users[username]) {
      this.users[username] = {};
    }
    this.users[username].role = role;

    this.auditLogger.log(
      actor,
      this.getUserRole(actor),
      "ROLE_ASSIGNED",
      username,
      "SUCCESS",
      { previous_role: previousRole, new_role: role }
    );
    return true;
  }

  /**
   * Retrieves all active (unexpired) delegations for a delegatee user.
   */
  getActiveDelegations(username, now = Date.now()) {
    if (!username) return [];
    const currentTime = typeof now === "number" ? now : new Date(now).getTime();

    return this.delegations.filter((d) => {
      if (!d || d.active === false) return false;
      if (d.delegatee !== username) return false;
      if (d.expires_at) {
        const exp = typeof d.expires_at === "number" ? d.expires_at : new Date(d.expires_at).getTime();
        if (currentTime >= exp) return false;
      }
      return true;
    });
  }

  /**
   * Computes effective permissions for a user including active delegations.
   */
  getEffectivePermissions(username, options = {}) {
    const userRoleName = options.role || this.getUserRole(username);
    const roleDef = this.roles[userRoleName];
    let permissions = new Set(roleDef ? roleDef.permissions || [] : []);

    // Custom user permissions
    const userData = this.users[username];
    if (userData && Array.isArray(userData.custom_permissions)) {
      userData.custom_permissions.forEach((p) => permissions.add(p));
    }

    // Delegated roles/permissions
    const activeDelegated = this.getActiveDelegations(username, options.now);
    for (const delegation of activeDelegated) {
      if (delegation.role && this.roles[delegation.role]) {
        const delegatedRolePerms = this.roles[delegation.role].permissions || [];
        delegatedRolePerms.forEach((p) => permissions.add(p));
      }
      if (Array.isArray(delegation.permissions)) {
        delegation.permissions.forEach((p) => permissions.add(p));
      }
    }

    return Array.from(permissions);
  }

  /**
   * Checks if a user has a specific permission.
   */
  checkPermission(username, requiredPermission, options = {}) {
    if (!this.enabled) return true;

    const effectivePerms = this.getEffectivePermissions(username, options);
    const allowed = hasPermission(effectivePerms, requiredPermission);
    const userRole = this.getUserRole(username);

    this.auditLogger.log(
      username,
      userRole,
      "PERMISSION_CHECK",
      Array.isArray(requiredPermission) ? requiredPermission.join(",") : String(requiredPermission),
      allowed ? "ALLOWED" : "DENIED",
      { effective_permissions: effectivePerms }
    );

    return allowed;
  }

  /**
   * Command Visibility Rules.
   * Determines if a command is visible to a user.
   */
  isCommandVisible(command, username, options = {}) {
    if (!this.enabled) return true;
    if (!command || typeof command !== "object") return false;

    const userRole = options.role || this.getUserRole(username);
    const effectivePerms = this.getEffectivePermissions(username, options);

    // Admin role bypasses visibility restrictions
    if (userRole === "admin" || effectivePerms.includes("*")) {
      return command.visibility !== "hidden";
    }

    // Hidden visibility
    if (command.visibility === "hidden") {
      return false;
    }

    // Admin-only visibility
    if (command.visibility === "admin-only") {
      return false;
    }

    // Base permission required to view commands
    if (!hasPermission(effectivePerms, DEFAULT_PERMISSIONS.COMMANDS_VIEW)) {
      return false;
    }

    // Check required_role / required_roles
    const reqRoles = command.required_roles || (command.required_role ? [command.required_role] : []);
    if (reqRoles.length > 0) {
      const activeDelegations = this.getActiveDelegations(username, options.now);
      const userRoles = new Set([userRole]);
      activeDelegations.forEach((d) => {
        if (d.role) userRoles.add(d.role);
      });

      const roleMatches = reqRoles.some((r) => userRoles.has(r));
      if (!roleMatches) return false;
    }

    // Check required_permissions
    const reqPerms = command.required_permissions || (command.required_permission ? [command.required_permission] : []);
    if (reqPerms.length > 0) {
      if (!hasPermission(effectivePerms, reqPerms)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Filters categories and commands returning only commands visible to the user.
   */
  getVisibleCommands(categories, username, options = {}) {
    if (!Array.isArray(categories)) return [];
    if (!this.enabled) return categories;

    const visibleCategories = [];
    for (const cat of categories) {
      if (!cat || typeof cat !== "object") continue;

      if (!this.isCommandVisible(cat, username, options)) {
        continue;
      }

      const visibleCmds = [];
      if (Array.isArray(cat.commands)) {
        for (const cmd of cat.commands) {
          if (this.isCommandVisible(cmd, username, options)) {
            visibleCmds.push(cmd);
          }
        }
      }

      if (visibleCmds.length > 0 || (cat.commands && cat.commands.length === 0)) {
        visibleCategories.push({
          ...cat,
          commands: visibleCmds,
        });
      }
    }

    return visibleCategories;
  }

  /**
   * Checks if command can be executed and whether approval is needed.
   */
  canExecuteCommand(command, username, options = {}) {
    if (!this.enabled) {
      return { allowed: true, requires_approval: false };
    }

    const commandName = typeof command === "string" ? command : (command.name || command.command);
    const cmdObj = typeof command === "object" ? command : { name: commandName };
    const userRole = options.role || this.getUserRole(username);
    const effectivePerms = this.getEffectivePermissions(username, options);

    // 1. Check command visibility & view access
    if (!this.isCommandVisible(cmdObj, username, options)) {
      this.auditLogger.log(username, userRole, "COMMAND_EXECUTE", commandName, "DENIED", {
        reason: "Command is not visible or allowed for user role",
      });
      return { allowed: false, requires_approval: false, reason: "Command not visible or accessible." };
    }

    // 2. Check execute permission
    if (!hasPermission(effectivePerms, DEFAULT_PERMISSIONS.COMMANDS_EXECUTE)) {
      this.auditLogger.log(username, userRole, "COMMAND_EXECUTE", commandName, "DENIED", {
        reason: "User lacks execute permission",
      });
      return { allowed: false, requires_approval: false, reason: "Execution permission denied." };
    }

    // 3. Check if command requires approval chain
    const requiresApproval = Boolean(cmdObj.requires_approval || cmdObj.approval_required || cmdObj.approval_chain);

    if (requiresApproval) {
      // Check if user has approval authority or is admin (can auto-execute)
      const canAutoApprove = hasPermission(effectivePerms, DEFAULT_PERMISSIONS.COMMANDS_APPROVE) || userRole === "admin";

      if (!canAutoApprove) {
        this.auditLogger.log(username, userRole, "COMMAND_EXECUTE", commandName, "PENDING_APPROVAL", {
          reason: "Command requires approver review",
        });
        return {
          allowed: false,
          requires_approval: true,
          reason: "Command execution requires admin or approver approval.",
        };
      }
    }

    this.auditLogger.log(username, userRole, "COMMAND_EXECUTE", commandName, "ALLOWED", {
      command_str: cmdObj.command || commandName,
    });

    return { allowed: true, requires_approval: false };
  }

  /**
   * Approval Chain Management.
   */
  createApprovalRequest(commandName, commandStr, requestedBy, reason = "") {
    const userRole = this.getUserRole(requestedBy);
    const request = {
      id: `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      command_name: commandName,
      command_str: commandStr || commandName,
      requested_by: requestedBy,
      role: userRole,
      status: "pending",
      reason: reason || "Execution requested",
      created_at: new Date().toISOString(),
      reviewed_by: null,
      reviewed_at: null,
      review_reason: null,
    };

    this.approvalRequests.unshift(request);

    this.auditLogger.log(requestedBy, userRole, "APPROVAL_REQUESTED", commandName, "PENDING", {
      approval_id: request.id,
      command_str: commandStr,
      reason,
    });

    return request;
  }

  approveRequest(requestId, reviewerUsername, reviewReason = "") {
    const reviewerRole = this.getUserRole(reviewerUsername);
    const effectivePerms = this.getEffectivePermissions(reviewerUsername);

    if (!hasPermission(effectivePerms, DEFAULT_PERMISSIONS.COMMANDS_APPROVE) && reviewerRole !== "admin") {
      this.auditLogger.log(reviewerUsername, reviewerRole, "APPROVAL_REVIEW", requestId, "DENIED", {
        reason: "Reviewer lacks approval permission",
      });
      throw new Error(`User '${reviewerUsername}' does not have permission to approve requests.`);
    }

    const req = this.approvalRequests.find((r) => r.id === requestId);
    if (!req) {
      throw new Error(`Approval request '${requestId}' not found.`);
    }

    req.status = "approved";
    req.reviewed_by = reviewerUsername;
    req.reviewed_at = new Date().toISOString();
    req.review_reason = reviewReason || "Approved";

    this.auditLogger.log(reviewerUsername, reviewerRole, "APPROVAL_APPROVED", req.command_name, "SUCCESS", {
      approval_id: requestId,
      requested_by: req.requested_by,
      review_reason: req.review_reason,
    });

    return req;
  }

  rejectRequest(requestId, reviewerUsername, reviewReason = "") {
    const reviewerRole = this.getUserRole(reviewerUsername);
    const effectivePerms = this.getEffectivePermissions(reviewerUsername);

    if (!hasPermission(effectivePerms, DEFAULT_PERMISSIONS.COMMANDS_APPROVE) && reviewerRole !== "admin") {
      this.auditLogger.log(reviewerUsername, reviewerRole, "APPROVAL_REVIEW", requestId, "DENIED", {
        reason: "Reviewer lacks approval permission",
      });
      throw new Error(`User '${reviewerUsername}' does not have permission to reject requests.`);
    }

    const req = this.approvalRequests.find((r) => r.id === requestId);
    if (!req) {
      throw new Error(`Approval request '${requestId}' not found.`);
    }

    req.status = "rejected";
    req.reviewed_by = reviewerUsername;
    req.reviewed_at = new Date().toISOString();
    req.review_reason = reviewReason || "Rejected";

    this.auditLogger.log(reviewerUsername, reviewerRole, "APPROVAL_REJECTED", req.command_name, "REJECTED", {
      approval_id: requestId,
      requested_by: req.requested_by,
      review_reason: req.review_reason,
    });

    return req;
  }

  getPendingApprovalRequests() {
    return this.approvalRequests.filter((r) => r.status === "pending");
  }

  /**
   * Delegation Management.
   */
  createDelegation({ delegator, delegatee, role, permissions, command_name, duration_ms, reason }) {
    const delegatorRole = this.getUserRole(delegator);
    const effectivePerms = this.getEffectivePermissions(delegator);

    if (!hasPermission(effectivePerms, DEFAULT_PERMISSIONS.RBAC_MANAGE) && delegatorRole !== "admin") {
      this.auditLogger.log(delegator, delegatorRole, "DELEGATION_CREATE", delegatee, "DENIED", {
        reason: "Delegator lacks rbac:manage permission",
      });
      throw new Error(`User '${delegator}' does not have permission to delegate roles.`);
    }

    const duration = duration_ms || 3600000;
    const expiresAt = Date.now() + duration;

    const delegation = {
      id: `del_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      delegator,
      delegatee,
      role: role || null,
      permissions: permissions || [],
      command_name: command_name || null,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      reason: reason || "Delegated access",
      active: true,
    };

    this.delegations.push(delegation);

    this.auditLogger.log(delegator, delegatorRole, "DELEGATION_CREATED", delegatee, "SUCCESS", {
      delegation_id: delegation.id,
      role,
      permissions,
      expires_at: new Date(expiresAt).toISOString(),
    });

    return delegation;
  }

  revokeDelegation(delegationId, revoker) {
    const revokerRole = this.getUserRole(revoker);
    const effectivePerms = this.getEffectivePermissions(revoker);

    const delegation = this.delegations.find((d) => d.id === delegationId);
    if (!delegation) {
      throw new Error(`Delegation '${delegationId}' not found.`);
    }

    if (revoker !== delegation.delegator && !hasPermission(effectivePerms, DEFAULT_PERMISSIONS.RBAC_MANAGE) && revokerRole !== "admin") {
      this.auditLogger.log(revoker, revokerRole, "DELEGATION_REVOKE", delegationId, "DENIED", {
        reason: "Revoker lacks permission",
      });
      throw new Error(`User '${revoker}' cannot revoke delegation created by '${delegation.delegator}'.`);
    }

    delegation.active = false;

    this.auditLogger.log(revoker, revokerRole, "DELEGATION_REVOKED", delegation.delegatee, "SUCCESS", {
      delegation_id: delegationId,
    });

    return delegation;
  }
}
