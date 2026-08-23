/**
 * Role-Based Access Control (RBAC) Manager for CmdBar.
 * Supports granular permissions, admin/user roles, command visibility rules,
 * approval chains, delegation, and audit trails.
 */

export const DEFAULT_RBAC_CONFIG = {
  enabled: true,
  default_role: "user",
  roles: {
    admin: {
      name: "Administrator",
      description: "Full system access with wildcard permissions",
      permissions: ["*"],
    },
    user: {
      name: "Standard User",
      description: "Standard command viewing and execution rights",
      permissions: ["command:view", "command:execute"],
    },
    operator: {
      name: "Operator",
      description: "Execution, viewing, and approval requesting capabilities",
      permissions: ["command:view", "command:execute", "approval:request"],
    },
    approver: {
      name: "Approver",
      description: "Command viewing and approval chain authorization",
      permissions: ["command:view", "command:approve"],
    },
    auditor: {
      name: "Auditor",
      description: "Read-only access to commands and audit logs",
      permissions: ["command:view", "audit:read"],
    },
  },
  user_roles: {
    admin: ["admin"],
    alice: ["admin"],
    bob: ["user"],
    charlie: ["operator"],
    david: ["approver"],
  },
  user_permissions: {},
  delegations: [],
  approval_requests: [],
  audit_logs: [],
};

export class RBACManager {
  constructor(config = {}) {
    this.loadConfig(config);
  }

  /**
   * Load or merge RBAC configuration.
   */
  loadConfig(config = {}) {
    const base = JSON.parse(JSON.stringify(DEFAULT_RBAC_CONFIG));
    this.enabled = config.enabled !== undefined ? Boolean(config.enabled) : base.enabled;
    this.defaultRole = config.default_role || base.default_role;
    this.roles = config.roles ? { ...base.roles, ...config.roles } : base.roles;
    this.userRoles = config.user_roles ? { ...base.user_roles, ...config.user_roles } : base.user_roles;
    this.userPermissions = config.user_permissions ? { ...base.user_permissions, ...config.user_permissions } : base.user_permissions;
    this.delegations = Array.isArray(config.delegations) ? [...config.delegations] : [...base.delegations];
    this.approvalRequests = Array.isArray(config.approval_requests) ? [...config.approval_requests] : [...base.approval_requests];
    this.auditLogs = Array.isArray(config.audit_logs) ? [...config.audit_logs] : [...base.audit_logs];
  }

  /**
   * Export current RBAC state to a plain JS object suitable for JSON serialization.
   */
  exportConfig() {
    return {
      enabled: this.enabled,
      default_role: this.defaultRole,
      roles: JSON.parse(JSON.stringify(this.roles)),
      user_roles: JSON.parse(JSON.stringify(this.userRoles)),
      user_permissions: JSON.parse(JSON.stringify(this.userPermissions)),
      delegations: JSON.parse(JSON.stringify(this.delegations)),
      approval_requests: JSON.parse(JSON.stringify(this.approvalRequests)),
      audit_logs: JSON.parse(JSON.stringify(this.auditLogs)),
    };
  }

  // --- Roles & Permissions ---

  /**
   * Get direct roles assigned to a user.
   */
  getUserRoles(user) {
    if (!user) return [this.defaultRole];
    const roles = this.userRoles[user];
    if (Array.isArray(roles) && roles.length > 0) {
      return [...roles];
    }
    return [this.defaultRole];
  }

  /**
   * Assign role(s) to a user.
   */
  assignUserRole(user, role, actor = "system") {
    if (!user || !role) return false;
    if (!this.userRoles[user]) {
      this.userRoles[user] = [];
    }
    const rolesToAdd = Array.isArray(role) ? role : [role];
    for (const r of rolesToAdd) {
      if (!this.userRoles[user].includes(r)) {
        this.userRoles[user].push(r);
      }
    }
    this.logAudit({
      actor,
      action: "ROLE_ASSIGNED",
      resource: user,
      outcome: "success",
      details: { assigned_roles: rolesToAdd },
    });
    return true;
  }

  /**
   * Remove role from a user.
   */
  removeUserRole(user, role, actor = "system") {
    if (!user || !role || !this.userRoles[user]) return false;
    this.userRoles[user] = this.userRoles[user].filter((r) => r !== role);
    this.logAudit({
      actor,
      action: "ROLE_REVOKED",
      resource: user,
      outcome: "success",
      details: { revoked_role: role },
    });
    return true;
  }

  /**
   * Get direct permissions assigned to a user.
   */
  getUserPermissions(user) {
    if (!user || !this.userPermissions[user]) return [];
    return [...this.userPermissions[user]];
  }

  /**
   * Assign explicit permission(s) to a user.
   */
  assignUserPermission(user, permission, actor = "system") {
    if (!user || !permission) return false;
    if (!this.userPermissions[user]) {
      this.userPermissions[user] = [];
    }
    const permsToAdd = Array.isArray(permission) ? permission : [permission];
    for (const p of permsToAdd) {
      if (!this.userPermissions[user].includes(p)) {
        this.userPermissions[user].push(p);
      }
    }
    this.logAudit({
      actor,
      action: "PERMISSION_ASSIGNED",
      resource: user,
      outcome: "success",
      details: { assigned_permissions: permsToAdd },
    });
    return true;
  }

  /**
   * Evaluate if a given list of user permissions satisfies a required permission.
   */
  static matchPermission(userPermissions, requiredPermission) {
    if (!Array.isArray(userPermissions) || !requiredPermission) return false;
    if (userPermissions.includes("*")) return true;
    if (userPermissions.includes(requiredPermission)) return true;

    for (const perm of userPermissions) {
      if (perm.endsWith("*")) {
        const prefix = perm.slice(0, -1);
        if (requiredPermission.startsWith(prefix)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get all active delegations for a given delegatee.
   */
  getActiveDelegations(user, currentTime = new Date()) {
    if (!user) return [];
    const now = new Date(currentTime).getTime();
    return this.delegations.filter((d) => {
      if (d.delegatee !== user || d.status !== "active") return false;
      const start = new Date(d.start_time).getTime();
      if (start > now) return false;
      if (d.end_time) {
        const end = new Date(d.end_time).getTime();
        if (end < now) {
          d.status = "expired";
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Resolve effective roles for a user (direct + active delegated).
   */
  getEffectiveRoles(user, currentTime = new Date()) {
    const rolesSet = new Set(this.getUserRoles(user));
    const activeDelegations = this.getActiveDelegations(user, currentTime);
    for (const d of activeDelegations) {
      if (Array.isArray(d.roles)) {
        d.roles.forEach((r) => rolesSet.add(r));
      }
    }
    return Array.from(rolesSet);
  }

  /**
   * Resolve effective permissions for a user (direct + role permissions + delegated).
   */
  getEffectivePermissions(user, currentTime = new Date()) {
    const permSet = new Set(this.getUserPermissions(user));
    const roles = this.getEffectiveRoles(user, currentTime);

    for (const r of roles) {
      const roleDef = this.roles[r];
      if (roleDef && Array.isArray(roleDef.permissions)) {
        roleDef.permissions.forEach((p) => permSet.add(p));
      }
    }

    const activeDelegations = this.getActiveDelegations(user, currentTime);
    for (const d of activeDelegations) {
      if (Array.isArray(d.permissions)) {
        d.permissions.forEach((p) => permSet.add(p));
      }
    }

    return Array.from(permSet);
  }

  /**
   * Check if user possesses a required permission.
   */
  hasPermission(user, requiredPermission, currentTime = new Date()) {
    if (!this.enabled) return true;
    const effectivePerms = this.getEffectivePermissions(user, currentTime);
    return RBACManager.matchPermission(effectivePerms, requiredPermission);
  }

  // --- Command Visibility Rules ---

  /**
   * Determines whether a user can view a specific command.
   */
  canViewCommand(user, command, currentTime = new Date()) {
    if (!this.enabled) return true;
    if (!command) return false;

    // Visibility rule property
    const visibility = command.visibility || "public";
    if (visibility === "hidden") {
      return false;
    }

    const effectiveRoles = this.getEffectiveRoles(user, currentTime);
    const effectivePerms = this.getEffectivePermissions(user, currentTime);

    if (visibility === "admin_only") {
      if (!effectiveRoles.includes("admin") && !effectivePerms.includes("*")) {
        return false;
      }
    }

    // Role restrictions: allowed_roles or roles array
    const allowedRoles = command.allowed_roles || command.roles;
    if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
      const hasRole = allowedRoles.some((r) => effectiveRoles.includes(r) || effectiveRoles.includes("admin"));
      if (!hasRole && !effectivePerms.includes("*")) {
        return false;
      }
    }

    // Permission restrictions: required_permissions or permissions array
    const requiredPermissions = command.required_permissions || command.permissions;
    if (Array.isArray(requiredPermissions) && requiredPermissions.length > 0) {
      const hasAllPerms = requiredPermissions.every((p) => RBACManager.matchPermission(effectivePerms, p));
      if (!hasAllPerms) {
        return false;
      }
    }

    // Min role check
    if (command.min_role) {
      if (command.min_role === "admin" && !effectiveRoles.includes("admin") && !effectivePerms.includes("*")) {
        return false;
      }
    }

    return true;
  }

  /**
   * Filter categories and commands visible to a user.
   */
  filterVisibleCommands(categories, user, currentTime = new Date()) {
    if (!this.enabled) return categories;
    if (!Array.isArray(categories)) return [];

    return categories
      .map((cat) => {
        const visibleCommands = Array.isArray(cat.commands)
          ? cat.commands.filter((cmd) => this.canViewCommand(user, cmd, currentTime))
          : [];
        return {
          ...cat,
          commands: visibleCommands,
        };
      })
      .filter((cat) => cat.commands.length > 0);
  }

  // --- Command Execution & Approval Chains ---

  /**
   * Check whether a command can be executed by a user, or if approval is needed.
   */
  canExecuteCommand(user, command, options = {}) {
    const currentTime = options.currentTime || new Date();
    const requestId = options.approval_request_id || options.requestId;

    if (!this.enabled) {
      return { allowed: true, status: "granted" };
    }

    // 1. Must pass visibility check
    if (!this.canViewCommand(user, command, currentTime)) {
      this.logAudit({
        actor: user,
        action: "COMMAND_EXECUTION_DENIED",
        resource: command ? command.name : "unknown",
        outcome: "denied",
        details: { reason: "Command not visible to user" },
      });
      return { allowed: false, status: "denied", reason: "Command not visible to user" };
    }

    // 2. Check required permission if command defines one
    const execPerm = command.execution_permission || command.required_permission || "command:execute";
    if (!this.hasPermission(user, execPerm, currentTime)) {
      this.logAudit({
        actor: user,
        action: "COMMAND_EXECUTION_DENIED",
        resource: command ? command.name : "unknown",
        outcome: "denied",
        details: { reason: `Missing required permission: ${execPerm}` },
      });
      return { allowed: false, status: "denied", reason: `Missing required permission: ${execPerm}` };
    }

    // 3. Approval Chain evaluation
    const requiresApproval = Boolean(command.requires_approval || (Array.isArray(command.approval_chain) && command.approval_chain.length > 0));

    if (requiresApproval) {
      const effectiveRoles = this.getEffectiveRoles(user, currentTime);
      // Admin bypass if configured or user is admin
      if (effectiveRoles.includes("admin") && options.bypass_approval_if_admin) {
        this.logAudit({
          actor: user,
          action: "COMMAND_EXECUTED",
          resource: command.name,
          outcome: "success",
          details: { admin_bypass: true },
        });
        return { allowed: true, status: "granted", admin_bypass: true };
      }

      if (requestId) {
        const req = this.getApprovalRequest(requestId);
        if (!req) {
          return { allowed: false, status: "denied", reason: "Approval request not found" };
        }
        if (req.status === "approved") {
          this.logAudit({
            actor: user,
            action: "COMMAND_EXECUTED",
            resource: command.name,
            outcome: "success",
            details: { approval_request_id: requestId },
          });
          return { allowed: true, status: "granted", approval_request_id: requestId };
        }
        return { allowed: false, status: req.status, reason: `Approval request is ${req.status}` };
      }

      // Create new approval request if auto_create_request is true or by default
      const approvalChain = Array.isArray(command.approval_chain) && command.approval_chain.length > 0
        ? command.approval_chain
        : ["approver"];

      const newReq = this.createApprovalRequest({
        command_name: command.name,
        command_id: command.id || command.name,
        requester: user,
        parameters: options.parameters || {},
        approval_chain: approvalChain,
      });

      return {
        allowed: false,
        status: "requires_approval",
        approval_request_id: newReq.id,
        request: newReq,
      };
    }

    this.logAudit({
      actor: user,
      action: "COMMAND_EXECUTED",
      resource: command ? command.name : "unknown",
      outcome: "success",
      details: { parameters: options.parameters },
    });

    return { allowed: true, status: "granted" };
  }

  /**
   * Create an approval request for a command.
   */
  createApprovalRequest({ command_name, command_id, requester, parameters = {}, approval_chain = ["approver"] }) {
    const req = {
      id: `appr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      command_name: command_name || "Unknown Command",
      command_id: command_id || command_name || "unknown",
      requester: requester || "anonymous",
      timestamp: new Date().toISOString(),
      parameters,
      approval_chain: [...approval_chain],
      approvals: [],
      status: "pending",
    };

    this.approvalRequests.push(req);

    this.logAudit({
      actor: requester,
      action: "APPROVAL_REQUESTED",
      resource: req.command_name,
      outcome: "pending",
      details: { request_id: req.id, approval_chain },
    });

    return req;
  }

  /**
   * Get an approval request by ID.
   */
  getApprovalRequest(requestId) {
    return this.approvalRequests.find((r) => r.id === requestId) || null;
  }

  /**
   * Approve an approval request.
   */
  approveRequest(requestId, approverUser, currentTime = new Date()) {
    const req = this.getApprovalRequest(requestId);
    if (!req) {
      throw new Error(`Approval request '${requestId}' not found.`);
    }
    if (req.status !== "pending") {
      throw new Error(`Cannot approve request '${requestId}': status is already '${req.status}'.`);
    }

    const effectiveRoles = this.getEffectiveRoles(approverUser, currentTime);
    const effectivePerms = this.getEffectivePermissions(approverUser, currentTime);

    // Check if approver can approve
    const canApprove =
      effectiveRoles.includes("admin") ||
      effectivePerms.includes("*") ||
      effectivePerms.includes("command:approve") ||
      req.approval_chain.some((roleOrPerm) =>
        effectiveRoles.includes(roleOrPerm) || RBACManager.matchPermission(effectivePerms, roleOrPerm)
      );

    if (!canApprove) {
      this.logAudit({
        actor: approverUser,
        action: "APPROVAL_DENIED",
        resource: req.command_name,
        outcome: "denied",
        details: { request_id: requestId, reason: "Approver lacks approval privileges" },
      });
      throw new Error(`User '${approverUser}' does not have permission to approve request '${requestId}'.`);
    }

    req.approvals.push({
      approver: approverUser,
      timestamp: new Date(currentTime).toISOString(),
    });

    // Check if all steps in approval_chain are satisfied
    const approvedRolesOrPerms = req.approvals.flatMap((a) => this.getEffectiveRoles(a.approver, currentTime));
    const approvedPerms = req.approvals.flatMap((a) => this.getEffectivePermissions(a.approver, currentTime));

    const allSatisfied = req.approval_chain.every(
      (required) =>
        approvedRolesOrPerms.includes("admin") ||
        approvedPerms.includes("*") ||
        approvedRolesOrPerms.includes(required) ||
        RBACManager.matchPermission(approvedPerms, required)
    );

    if (allSatisfied) {
      req.status = "approved";
    }

    this.logAudit({
      actor: approverUser,
      action: "APPROVAL_GRANTED",
      resource: req.command_name,
      outcome: req.status,
      details: { request_id: requestId, chain_status: req.status },
    });

    return req;
  }

  /**
   * Reject an approval request.
   */
  rejectRequest(requestId, approverUser, reason = "Rejected by approver") {
    const req = this.getApprovalRequest(requestId);
    if (!req) {
      throw new Error(`Approval request '${requestId}' not found.`);
    }
    if (req.status !== "pending") {
      throw new Error(`Cannot reject request '${requestId}': status is already '${req.status}'.`);
    }

    req.status = "rejected";
    req.rejection_reason = reason;
    req.rejected_by = approverUser;
    req.rejected_at = new Date().toISOString();

    this.logAudit({
      actor: approverUser,
      action: "APPROVAL_REJECTED",
      resource: req.command_name,
      outcome: "rejected",
      details: { request_id: requestId, reason },
    });

    return req;
  }

  // --- Delegation ---

  /**
   * Create a delegation of roles or permissions from delegator to delegatee.
   */
  createDelegation({ delegator, delegatee, roles = [], permissions = [], start_time, end_time, actor }) {
    if (!delegator || !delegatee) {
      throw new Error("Delegation requires both delegator and delegatee.");
    }

    const delegation = {
      id: `del_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      delegator,
      delegatee,
      roles: Array.isArray(roles) ? [...roles] : [],
      permissions: Array.isArray(permissions) ? [...permissions] : [],
      start_time: start_time ? new Date(start_time).toISOString() : new Date().toISOString(),
      end_time: end_time ? new Date(end_time).toISOString() : null,
      status: "active",
      created_at: new Date().toISOString(),
    };

    this.delegations.push(delegation);

    this.logAudit({
      actor: actor || delegator,
      action: "DELEGATION_CREATED",
      resource: delegatee,
      outcome: "success",
      details: { delegation_id: delegation.id, delegator, roles, permissions },
    });

    return delegation;
  }

  /**
   * Revoke an active delegation.
   */
  revokeDelegation(delegationId, revokedBy = "system") {
    const del = this.delegations.find((d) => d.id === delegationId);
    if (!del) {
      throw new Error(`Delegation '${delegationId}' not found.`);
    }

    del.status = "revoked";
    del.revoked_at = new Date().toISOString();
    del.revoked_by = revokedBy;

    this.logAudit({
      actor: revokedBy,
      action: "DELEGATION_REVOKED",
      resource: del.delegatee,
      outcome: "success",
      details: { delegation_id: delegationId, delegator: del.delegator },
    });

    return del;
  }

  // --- Audit Trail ---

  /**
   * Log an audit event entry.
   */
  logAudit({ actor = "system", action, resource = "", outcome = "success", details = {} }) {
    const entry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      resource,
      outcome,
      details: details || {},
    };
    this.auditLogs.push(entry);
    return entry;
  }

  /**
   * Query audit logs with filters.
   */
  queryAuditLogs(filters = {}) {
    let result = [...this.auditLogs];

    if (filters.actor) {
      result = result.filter((l) => l.actor === filters.actor);
    }
    if (filters.action) {
      result = result.filter((l) => l.action === filters.action);
    }
    if (filters.resource) {
      result = result.filter((l) => l.resource === filters.resource);
    }
    if (filters.outcome) {
      result = result.filter((l) => l.outcome === filters.outcome);
    }
    if (filters.start_date) {
      const start = new Date(filters.start_date).getTime();
      result = result.filter((l) => new Date(l.timestamp).getTime() >= start);
    }
    if (filters.end_date) {
      const end = new Date(filters.end_date).getTime();
      result = result.filter((l) => new Date(l.timestamp).getTime() <= end);
    }

    const offset = filters.offset || 0;
    const limit = filters.limit ? filters.limit : result.length;

    return result.slice(offset, offset + limit);
  }

  /**
   * Export audit logs as formatted string (JSON or CSV).
   */
  exportAuditLogs(format = "json", filters = {}) {
    const logs = this.queryAuditLogs(filters);

    if (format.toLowerCase() === "csv") {
      const headers = ["id", "timestamp", "actor", "action", "resource", "outcome", "details"];
      const rows = logs.map((l) => [
        l.id,
        l.timestamp,
        `"${l.actor.replace(/"/g, '""')}"`,
        `"${l.action.replace(/"/g, '""')}"`,
        `"${l.resource.replace(/"/g, '""')}"`,
        `"${l.outcome.replace(/"/g, '""')}"`,
        `"${JSON.stringify(l.details).replace(/"/g, '""')}"`,
      ].join(","));
      return [headers.join(","), ...rows].join("\n");
    }

    return JSON.stringify(logs, null, 2);
  }
}
