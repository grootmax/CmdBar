/**
 * @module workspaceManager
 * Organization Workspaces Manager for CmdBar.
 * Provides team workspaces, shared command synchronization, role-based admin controls,
 * usage analytics tracking & export, subscription billing management, private registries,
 * and Slack webhook & slash command integration.
 */

import crypto from "crypto";

/**
 * Workspace roles
 * @public
 */
export const WORKSPACE_ROLES = {
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
};

/**
 * Role hierarchy levels
 * @internal
 */
const ROLE_LEVELS = {
  [WORKSPACE_ROLES.ADMIN]: 3,
  [WORKSPACE_ROLES.MEMBER]: 2,
  [WORKSPACE_ROLES.VIEWER]: 1,
};

/**
 * Plan tiers
 * @public
 */
export const PLAN_TIERS = {
  FREE: "free",
  PRO: "pro",
  ENTERPRISE: "enterprise",
};

/**
 * Default limits per plan tier
 * @public
 */
export const PLAN_LIMITS = {
  [PLAN_TIERS.FREE]: {
    maxWorkspaces: 1,
    maxMembers: 5,
    maxSharedCommands: 10,
    privateRegistryEnabled: false,
    slackIntegrationEnabled: false,
  },
  [PLAN_TIERS.PRO]: {
    maxWorkspaces: 5,
    maxMembers: 25,
    maxSharedCommands: 100,
    privateRegistryEnabled: false,
    slackIntegrationEnabled: true,
  },
  [PLAN_TIERS.ENTERPRISE]: {
    maxWorkspaces: Infinity,
    maxMembers: Infinity,
    maxSharedCommands: Infinity,
    privateRegistryEnabled: true,
    slackIntegrationEnabled: true,
  },
};

/**
 * Manager class for organization workspaces.
 * @public
 */
export class WorkspaceManager {
  /**
   * Initializes WorkspaceManager instance.
   * @public
   */
  constructor() {
    this.workspaces = new Map();
    this.analyticsEvents = [];
    this.privateRegistries = new Map();
  }

  /**
   * Helper to generate UUIDs or random hex strings.
   * @internal
   */
  _generateId(prefix = "ws") {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
  }

  /**
   * Creates a new workspace.
   * @public
   * @param {object} params
   * @param {string} params.name
   * @param {string} [params.description=""]
   * @param {string} params.orgId
   * @param {string} params.ownerId
   * @param {string} [params.planTier='free']
   * @returns {object} Workspace object
   */
  createWorkspace({ name, description = "", orgId, ownerId, planTier = PLAN_TIERS.FREE }) {
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new Error("Workspace name is required and must be a non-empty string.");
    }
    if (!orgId || !ownerId) {
      throw new Error("orgId and ownerId are required to create a workspace.");
    }

    const tier = PLAN_TIERS[planTier.toUpperCase()] || PLAN_TIERS.FREE;
    const existingForOrg = this.listWorkspaces(orgId);
    const limit = PLAN_LIMITS[tier].maxWorkspaces;
    if (existingForOrg.length >= limit) {
      throw new Error(`Workspace creation limit reached for plan tier '${tier}' (${limit}).`);
    }

    const id = this._generateId("ws");
    const workspace = {
      id,
      name: name.trim(),
      description: description.trim(),
      orgId,
      ownerId,
      planTier: tier,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      members: [
        {
          userId: ownerId,
          name: "Owner",
          email: `${ownerId}@org.com`,
          role: WORKSPACE_ROLES.ADMIN,
          joinedAt: new Date().toISOString(),
        },
      ],
      sharedCategories: [],
      adminSettings: {
        allowedExecutionModes: ["shell-quoted", "direct-array"],
        prohibitedPatterns: ["rm\\s+-rf\\s+/", "chmod\\s+777\\s+/"],
        requireConfirmation: true,
        allowedHosts: [],
        enforceAdminOnlyEdit: true,
      },
      auditLogs: [
        {
          id: this._generateId("audit"),
          timestamp: new Date().toISOString(),
          actorId: ownerId,
          action: "WORKSPACE_CREATED",
          details: `Workspace '${name}' created with plan tier '${tier}'.`,
        },
      ],
      billing: {
        planTier: tier,
        seatLimit: PLAN_LIMITS[tier].maxMembers,
        commandLimit: PLAN_LIMITS[tier].maxSharedCommands,
        status: "active",
        billingEmail: `${ownerId}@org.com`,
        renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
      privateRegistry: {
        enabled: PLAN_LIMITS[tier].privateRegistryEnabled,
        installedPackages: [],
      },
      slackIntegration: {
        enabled: PLAN_LIMITS[tier].slackIntegrationEnabled,
        webhookUrl: "",
        signingSecret: "secret_" + this._generateId("slack"),
        enabledEvents: ["command_execution", "audit_log", "member_joined"],
      },
    };

    this.workspaces.set(id, workspace);
    this.privateRegistries.set(id, new Map());
    return workspace;
  }

  /**
   * Retrieves a workspace by ID.
   * @public
   * @param {string} workspaceId
   * @returns {object|null}
   */
  getWorkspace(workspaceId) {
    return this.workspaces.get(workspaceId) || null;
  }

  /**
   * Updates workspace configuration/settings.
   * @public
   * @param {string} workspaceId
   * @param {object} updates
   * @param {string} actorId
   * @returns {object}
   */
  updateWorkspace(workspaceId, updates, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace with ID '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error(`Actor '${actorId}' lacks ADMIN permissions for workspace '${workspaceId}'.`);
    }

    if (updates.name && typeof updates.name === "string") {
      ws.name = updates.name.trim();
    }
    if (updates.description !== undefined && typeof updates.description === "string") {
      ws.description = updates.description.trim();
    }
    if (updates.adminSettings && typeof updates.adminSettings === "object") {
      ws.adminSettings = { ...ws.adminSettings, ...updates.adminSettings };
    }
    if (updates.slackIntegration && typeof updates.slackIntegration === "object") {
      ws.slackIntegration = { ...ws.slackIntegration, ...updates.slackIntegration };
    }

    ws.updatedAt = new Date().toISOString();
    this._logAudit(ws, actorId, "WORKSPACE_UPDATED", `Updated workspace settings.`);
    return ws;
  }

  /**
   * Deletes a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} actorId
   * @returns {boolean}
   */
  deleteWorkspace(workspaceId, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return false;
    if (ws.ownerId !== actorId && !this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error(`Actor '${actorId}' is not authorized to delete workspace '${workspaceId}'.`);
    }
    this.privateRegistries.delete(workspaceId);
    return this.workspaces.delete(workspaceId);
  }

  /**
   * Lists workspaces for an organization.
   * @public
   * @param {string} orgId
   * @returns {Array<object>}
   */
  listWorkspaces(orgId) {
    const list = [];
    for (const ws of this.workspaces.values()) {
      if (ws.orgId === orgId) {
        list.push(ws);
      }
    }
    return list;
  }

  // --- Member Management ---

  /**
   * Adds a member to a workspace.
   * @public
   * @param {string} workspaceId
   * @param {object} memberData - { userId, name, email, role }
   * @param {string} actorId
   * @returns {object} Member object
   */
  addMember(workspaceId, { userId, name = "", email = "", role = WORKSPACE_ROLES.MEMBER }, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only workspace ADMINs can add members.");
    }

    const checkSeats = this.checkPlanLimits(workspaceId, "members");
    if (!checkSeats.allowed) {
      throw new Error(checkSeats.reason);
    }

    if (ws.members.some((m) => m.userId === userId)) {
      throw new Error(`User '${userId}' is already a member of workspace '${workspaceId}'.`);
    }

    const memberRole = WORKSPACE_ROLES[role.toUpperCase()] || WORKSPACE_ROLES.MEMBER;
    const member = {
      userId,
      name: name || userId,
      email: email || `${userId}@org.com`,
      role: memberRole,
      joinedAt: new Date().toISOString(),
    };

    ws.members.push(member);
    ws.updatedAt = new Date().toISOString();
    this._logAudit(ws, actorId, "MEMBER_ADDED", `Added member '${userId}' with role '${memberRole}'.`);
    this.sendSlackNotification(workspaceId, "member_joined", { member });
    return member;
  }

  /**
   * Updates a member's role.
   * @public
   * @param {string} workspaceId
   * @param {string} targetUserId
   * @param {string} newRole
   * @param {string} actorId
   * @returns {object}
   */
  updateMemberRole(workspaceId, targetUserId, newRole, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only workspace ADMINs can update member roles.");
    }

    const member = ws.members.find((m) => m.userId === targetUserId);
    if (!member) throw new Error(`Member '${targetUserId}' not found in workspace.`);

    const roleVal = WORKSPACE_ROLES[newRole.toUpperCase()] || WORKSPACE_ROLES.MEMBER;
    const oldRole = member.role;
    member.role = roleVal;
    ws.updatedAt = new Date().toISOString();

    this._logAudit(ws, actorId, "ROLE_UPDATED", `Updated role for '${targetUserId}' from '${oldRole}' to '${roleVal}'.`);
    return member;
  }

  /**
   * Removes a member from a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} targetUserId
   * @param {string} actorId
   * @returns {boolean}
   */
  removeMember(workspaceId, targetUserId, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only workspace ADMINs can remove members.");
    }
    if (ws.ownerId === targetUserId) {
      throw new Error("Cannot remove workspace owner.");
    }

    const idx = ws.members.findIndex((m) => m.userId === targetUserId);
    if (idx === -1) return false;

    ws.members.splice(idx, 1);
    ws.updatedAt = new Date().toISOString();
    this._logAudit(ws, actorId, "MEMBER_REMOVED", `Removed member '${targetUserId}' from workspace.`);
    return true;
  }

  /**
   * Checks whether a user has a required role or higher in a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} requiredRole
   * @returns {boolean}
   */
  hasPermission(workspaceId, userId, requiredRole) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return false;
    const member = ws.members.find((m) => m.userId === userId);
    if (!member) return false;

    const userLevel = ROLE_LEVELS[member.role] || 0;
    const requiredLevel = ROLE_LEVELS[requiredRole] || 1;
    return userLevel >= requiredLevel;
  }

  // --- Shared Commands & Policy Enforcement ---

  /**
   * Adds a shared command to a workspace category.
   * @public
   * @param {string} workspaceId
   * @param {string} categoryName
   * @param {object} commandData
   * @param {string} actorId
   * @returns {object}
   */
  addSharedCommand(workspaceId, categoryName, commandData, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);

    if (ws.adminSettings.enforceAdminOnlyEdit && !this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Workspace policy restricts command editing to ADMINs only.");
    } else if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.MEMBER)) {
      throw new Error("Actor lacks permission to edit workspace commands.");
    }

    const cmdCheck = this.checkPlanLimits(workspaceId, "commands");
    if (!cmdCheck.allowed) {
      throw new Error(cmdCheck.reason);
    }

    const policyValidation = this.validateCommandAgainstPolicies(workspaceId, commandData);
    if (!policyValidation.allowed) {
      throw new Error(`Command blocked by workspace security policy: ${policyValidation.reason}`);
    }

    let cat = ws.sharedCategories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!cat) {
      cat = { name: categoryName, commands: [] };
      ws.sharedCategories.push(cat);
    }

    const existingIdx = cat.commands.findIndex((c) => c.name.toLowerCase() === commandData.name.toLowerCase());
    if (existingIdx !== -1) {
      cat.commands[existingIdx] = { ...commandData };
    } else {
      cat.commands.push({ ...commandData });
    }

    ws.updatedAt = new Date().toISOString();
    this._logAudit(ws, actorId, "COMMAND_ADDED", `Added shared command '${commandData.name}' to category '${categoryName}'.`);
    return commandData;
  }

  /**
   * Removes a shared command from a category.
   * @public
   * @param {string} workspaceId
   * @param {string} categoryName
   * @param {string} commandName
   * @param {string} actorId
   * @returns {boolean}
   */
  removeSharedCommand(workspaceId, categoryName, commandName, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);

    if (ws.adminSettings.enforceAdminOnlyEdit && !this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Workspace policy restricts command editing to ADMINs only.");
    } else if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.MEMBER)) {
      throw new Error("Actor lacks permission to edit workspace commands.");
    }

    const cat = ws.sharedCategories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!cat) return false;

    const idx = cat.commands.findIndex((c) => c.name.toLowerCase() === commandName.toLowerCase());
    if (idx === -1) return false;

    cat.commands.splice(idx, 1);
    if (cat.commands.length === 0) {
      const catIdx = ws.sharedCategories.indexOf(cat);
      if (catIdx !== -1) ws.sharedCategories.splice(catIdx, 1);
    }

    ws.updatedAt = new Date().toISOString();
    this._logAudit(ws, actorId, "COMMAND_REMOVED", `Removed command '${commandName}' from category '${categoryName}'.`);
    return true;
  }

  /**
   * Merges workspace shared categories/commands into a base CmdBar config object.
   * @public
   * @param {string} workspaceId
   * @param {object} baseConfig
   * @returns {object} Merged configuration
   */
  getMergedConfig(workspaceId, baseConfig = {}) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return baseConfig;

    const merged = JSON.parse(JSON.stringify(baseConfig));
    if (!Array.isArray(merged.categories)) {
      merged.categories = [];
    }

    for (const wsCat of ws.sharedCategories) {
      let targetCat = merged.categories.find((c) => c.name.toLowerCase() === wsCat.name.toLowerCase());
      if (!targetCat) {
        targetCat = { name: wsCat.name, commands: [] };
        merged.categories.push(targetCat);
      }
      if (!Array.isArray(targetCat.commands)) {
        targetCat.commands = [];
      }

      for (const cmd of wsCat.commands) {
        const dupIdx = targetCat.commands.findIndex((c) => c.name.toLowerCase() === cmd.name.toLowerCase());
        const taggedCmd = { ...cmd, workspaceId: ws.id, workspaceName: ws.name };
        if (dupIdx !== -1) {
          targetCat.commands[dupIdx] = taggedCmd;
        } else {
          targetCat.commands.push(taggedCmd);
        }
      }
    }

    return merged;
  }

  /**
   * Validates a command against workspace admin policies.
   * @public
   * @param {string} workspaceId
   * @param {object} commandData
   * @returns {{ allowed: boolean, reason: string|null }}
   */
  validateCommandAgainstPolicies(workspaceId, commandData) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return { allowed: true, reason: null };

    const settings = ws.adminSettings;
    const mode = commandData.mode || "shell-quoted";
    if (Array.isArray(settings.allowedExecutionModes) && !settings.allowedExecutionModes.includes(mode)) {
      return {
        allowed: false,
        reason: `Execution mode '${mode}' is disallowed by workspace admin policy.`,
      };
    }

    const cmdString = commandData.command || "";
    if (Array.isArray(settings.prohibitedPatterns)) {
      for (const pattern of settings.prohibitedPatterns) {
        const re = new RegExp(pattern, "i");
        if (re.test(cmdString)) {
          return {
            allowed: false,
            reason: `Command string matches prohibited security pattern '${pattern}'.`,
          };
        }
      }
    }

    if (Array.isArray(settings.allowedHosts) && settings.allowedHosts.length > 0) {
      if (cmdString.includes("ping") || cmdString.includes("curl") || cmdString.includes("ssh")) {
        const matched = settings.allowedHosts.some((host) => cmdString.includes(host));
        if (!matched) {
          return {
            allowed: false,
            reason: `Command targets host not included in allowed hosts list (${settings.allowedHosts.join(", ")}).`,
          };
        }
      }
    }

    return { allowed: true, reason: null };
  }

  // --- Usage Analytics ---

  /**
   * Records a command execution event.
   * @public
   * @param {object} event
   * @returns {object} Event record
   */
  recordCommandExecution({ workspaceId, commandId, commandName, userId, durationMs = 0, success = true, errorMessage = null }) {
    const event = {
      id: this._generateId("evt"),
      workspaceId,
      commandId: commandId || commandName,
      commandName,
      userId,
      timestamp: new Date().toISOString(),
      durationMs,
      success: Boolean(success),
      errorMessage: errorMessage || null,
    };

    this.analyticsEvents.push(event);

    if (workspaceId && !success) {
      this.sendSlackNotification(workspaceId, "command_execution_failure", { event });
    }

    return event;
  }

  /**
   * Returns analytics summary for a workspace.
   * @public
   * @param {string} workspaceId
   * @returns {object} Summary stats
   */
  getAnalyticsSummary(workspaceId) {
    const events = this.analyticsEvents.filter((e) => e.workspaceId === workspaceId);
    const totalExecutions = events.length;
    const successful = events.filter((e) => e.success).length;
    const failed = totalExecutions - successful;
    const successRate = totalExecutions > 0 ? (successful / totalExecutions) * 100 : 100;

    const totalDuration = events.reduce((acc, e) => acc + (e.durationMs || 0), 0);
    const avgDurationMs = totalExecutions > 0 ? totalDuration / totalExecutions : 0;

    const commandCounts = {};
    const userCounts = {};

    for (const e of events) {
      commandCounts[e.commandName] = (commandCounts[e.commandName] || 0) + 1;
      userCounts[e.userId] = (userCounts[e.userId] || 0) + 1;
    }

    const topCommands = Object.entries(commandCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const activeUsers = Object.entries(userCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count);

    return {
      workspaceId,
      totalExecutions,
      successful,
      failed,
      successRate: Math.round(successRate * 100) / 100,
      avgDurationMs: Math.round(avgDurationMs * 100) / 100,
      topCommands,
      activeUsers,
    };
  }

  /**
   * Exports analytics data as CSV string.
   * @public
   * @param {string} workspaceId
   * @returns {string} CSV format
   */
  exportAnalyticsCSV(workspaceId) {
    const events = this.analyticsEvents.filter((e) => e.workspaceId === workspaceId);
    const headers = ["id", "timestamp", "userId", "commandName", "durationMs", "success", "errorMessage"];
    const rows = [headers.join(",")];

    for (const e of events) {
      const row = [
        e.id,
        e.timestamp,
        e.userId,
        `"${(e.commandName || "").replace(/"/g, '""')}"`,
        e.durationMs,
        e.success,
        `"${(e.errorMessage || "").replace(/"/g, '""')}"`,
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  /**
   * Exports analytics data as JSON string.
   * @public
   * @param {string} workspaceId
   * @returns {string} JSON format
   */
  exportAnalyticsJSON(workspaceId) {
    const events = this.analyticsEvents.filter((e) => e.workspaceId === workspaceId);
    return JSON.stringify(events, null, 2);
  }

  // --- Billing & Limits ---

  /**
   * Updates workspace billing plan tier.
   * @public
   * @param {string} workspaceId
   * @param {string} newPlanTier
   * @param {object} [details]
   * @param {string} actorId
   * @returns {object} Billing details
   */
  updateBillingPlan(workspaceId, newPlanTier, details = {}, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only workspace ADMINs can update billing plans.");
    }

    const tier = PLAN_TIERS[newPlanTier.toUpperCase()] || PLAN_TIERS.FREE;
    ws.planTier = tier;
    ws.billing = {
      ...ws.billing,
      planTier: tier,
      seatLimit: PLAN_LIMITS[tier].maxMembers,
      commandLimit: PLAN_LIMITS[tier].maxSharedCommands,
      ...details,
    };
    ws.privateRegistry.enabled = PLAN_LIMITS[tier].privateRegistryEnabled;
    ws.slackIntegration.enabled = PLAN_LIMITS[tier].slackIntegrationEnabled;

    ws.updatedAt = new Date().toISOString();
    this._logAudit(ws, actorId, "BILLING_PLAN_UPDATED", `Updated plan tier to '${tier}'.`);
    return ws.billing;
  }

  /**
   * Checks whether workspace satisfies plan limits.
   * @public
   * @param {string} workspaceId
   * @param {string} featureOrLimit
   * @returns {{ allowed: boolean, limit: number|boolean, current: number, reason: string|null }}
   */
  checkPlanLimits(workspaceId, featureOrLimit) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return { allowed: false, limit: 0, current: 0, reason: "Workspace not found." };

    const tier = ws.planTier;
    const limits = PLAN_LIMITS[tier];

    if (featureOrLimit === "members") {
      const current = ws.members.length;
      const limit = limits.maxMembers;
      const allowed = current < limit;
      return {
        allowed,
        limit,
        current,
        reason: allowed ? null : `Plan seat limit reached (${current}/${limit}) for plan tier '${tier}'. Upgrade to Pro/Enterprise.`,
      };
    } else if (featureOrLimit === "commands") {
      let current = 0;
      for (const cat of ws.sharedCategories) {
        current += cat.commands.length;
      }
      const limit = limits.maxSharedCommands;
      const allowed = current < limit;
      return {
        allowed,
        limit,
        current,
        reason: allowed ? null : `Shared command limit reached (${current}/${limit}) for plan tier '${tier}'. Upgrade plan tier.`,
      };
    } else if (featureOrLimit === "privateRegistry") {
      const allowed = limits.privateRegistryEnabled;
      return {
        allowed,
        limit: allowed,
        current: ws.privateRegistry.installedPackages.length,
        reason: allowed ? null : `Private registry is an Enterprise feature. Upgrade to Enterprise tier.`,
      };
    } else if (featureOrLimit === "slackIntegration") {
      const allowed = limits.slackIntegrationEnabled;
      return {
        allowed,
        limit: allowed,
        current: ws.slackIntegration.enabled ? 1 : 0,
        reason: allowed ? null : `Slack integration requires Pro or Enterprise plan tier.`,
      };
    }

    return { allowed: true, limit: Infinity, current: 0, reason: null };
  }

  // --- Private Registries ---

  /**
   * Publishes a command package to workspace private registry.
   * @public
   * @param {string} workspaceId
   * @param {object} packageData
   * @param {string} actorId
   * @returns {object} Package record
   */
  publishPackage(workspaceId, { id, name, version = "1.0.0", description = "", commands = [], publisher = "internal" }, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only ADMINs can publish private registry packages.");
    }

    const checkReg = this.checkPlanLimits(workspaceId, "privateRegistry");
    if (!checkReg.allowed) throw new Error(checkReg.reason);

    const reg = this.privateRegistries.get(workspaceId);
    const pkgId = id || this._generateId("pkg");
    const pkgRecord = {
      id: pkgId,
      name: name || pkgId,
      version,
      description,
      commands,
      publisher,
      publishedAt: new Date().toISOString(),
      checksum: crypto.createHash ? crypto.createHash("sha256").update(JSON.stringify(commands)).digest("hex") : "sha256_mock",
    };

    reg.set(pkgId, pkgRecord);
    this._logAudit(ws, actorId, "PACKAGE_PUBLISHED", `Published package '${pkgRecord.name}' v${version}.`);
    this.sendSlackNotification(workspaceId, "package_published", { package: pkgRecord });
    return pkgRecord;
  }

  /**
   * Lists packages in workspace private registry.
   * @public
   * @param {string} workspaceId
   * @returns {Array<object>}
   */
  listPackages(workspaceId) {
    const reg = this.privateRegistries.get(workspaceId);
    if (!reg) return [];
    return Array.from(reg.values());
  }

  /**
   * Searches packages in workspace private registry.
   * @public
   * @param {string} workspaceId
   * @param {string} query
   * @returns {Array<object>}
   */
  searchPackages(workspaceId, query) {
    const pkgs = this.listPackages(workspaceId);
    if (!query || !query.trim()) return pkgs;
    const q = query.toLowerCase().trim();
    return pkgs.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }

  /**
   * Installs a package from private registry into workspace categories.
   * @public
   * @param {string} workspaceId
   * @param {string} packageId
   * @param {string} actorId
   * @returns {object} Workspace object
   */
  installPackage(workspaceId, packageId, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only ADMINs can install private registry packages.");
    }

    const reg = this.privateRegistries.get(workspaceId);
    if (!reg || !reg.has(packageId)) {
      throw new Error(`Package '${packageId}' not found in private registry.`);
    }

    const pkg = reg.get(packageId);
    const catName = `Package: ${pkg.name}`;

    for (const cmd of pkg.commands) {
      this.addSharedCommand(workspaceId, catName, cmd, actorId);
    }

    if (!ws.privateRegistry.installedPackages.includes(packageId)) {
      ws.privateRegistry.installedPackages.push(packageId);
    }

    this._logAudit(ws, actorId, "PACKAGE_INSTALLED", `Installed package '${pkg.name}' v${pkg.version}.`);
    return ws;
  }

  /**
   * Uninstalls a package from workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} packageId
   * @param {string} actorId
   * @returns {boolean}
   */
  uninstallPackage(workspaceId, packageId, actorId) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found.`);
    if (!this.hasPermission(workspaceId, actorId, WORKSPACE_ROLES.ADMIN)) {
      throw new Error("Only ADMINs can uninstall private registry packages.");
    }

    const reg = this.privateRegistries.get(workspaceId);
    const pkg = reg ? reg.get(packageId) : null;
    const catName = pkg ? `Package: ${pkg.name}` : null;

    if (catName) {
      const idx = ws.sharedCategories.findIndex((c) => c.name.toLowerCase() === catName.toLowerCase());
      if (idx !== -1) ws.sharedCategories.splice(idx, 1);
    }

    const pkgIdx = ws.privateRegistry.installedPackages.indexOf(packageId);
    if (pkgIdx !== -1) ws.privateRegistry.installedPackages.splice(pkgIdx, 1);

    this._logAudit(ws, actorId, "PACKAGE_UNINSTALLED", `Uninstalled package '${packageId}'.`);
    return true;
  }

  // --- Slack Integration ---

  /**
   * Generates formatted Slack webhook payload.
   * @public
   * @param {string} workspaceId
   * @param {string} eventType
   * @param {object} payloadData
   * @returns {object} Slack payload structure
   */
  sendSlackNotification(workspaceId, eventType, payloadData) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws || !ws.slackIntegration.enabled) return null;
    if (!ws.slackIntegration.enabledEvents.includes(eventType)) return null;

    const payload = {
      text: `[CmdBar Workspace Alert: ${ws.name}] Event: ${eventType}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `⚡ CmdBar Alert: ${ws.name}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Event:* \`${eventType}\`\n*Workspace:* ${ws.name} (\`${ws.id}\`)\n*Details:* ${JSON.stringify(payloadData)}`,
          },
        },
      ],
    };

    return payload;
  }

  /**
   * Handles incoming Slack slash command simulation.
   * @public
   * @param {string} workspaceId
   * @param {object} slackPayload - { command, text, user_id, user_name }
   * @param {string} [signature]
   * @param {string} [timestamp]
   * @returns {object} Slack response object
   */
  handleSlackSlashCommand(workspaceId, slackPayload, signature = null, timestamp = null) {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return { response_type: "ephemeral", text: "Workspace not found." };
    if (!ws.slackIntegration.enabled) {
      return { response_type: "ephemeral", text: "Slack integration is disabled for this workspace." };
    }

    // Optional signature check simulation
    if (signature && ws.slackIntegration.signingSecret) {
      const computed = "v0=" + crypto.createHmac("sha256", ws.slackIntegration.signingSecret).update(`v0:${timestamp}:${JSON.stringify(slackPayload)}`).digest("hex");
      if (signature !== computed) {
        return { response_type: "ephemeral", text: "Invalid Slack webhook signature." };
      }
    }

    const text = (slackPayload.text || "").trim();
    const parts = text.split(/\s+/);
    const subCmd = parts[0] ? parts[0].toLowerCase() : "list";

    if (subCmd === "list") {
      const catCount = ws.sharedCategories.length;
      let totalCmds = 0;
      for (const c of ws.sharedCategories) totalCmds += c.commands.length;
      return {
        response_type: "in_channel",
        text: `*CmdBar Workspace Commands (${ws.name})*\nCategories: ${catCount} | Shared Commands: ${totalCmds}`,
      };
    } else if (subCmd === "stats") {
      const stats = this.getAnalyticsSummary(workspaceId);
      return {
        response_type: "in_channel",
        text: `*CmdBar Usage Stats (${ws.name})*\nTotal Executions: ${stats.totalExecutions} | Success Rate: ${stats.successRate}% | Avg Duration: ${stats.avgDurationMs}ms`,
      };
    } else if (subCmd === "exec") {
      const cmdName = parts.slice(1).join(" ");
      return {
        response_type: "in_channel",
        text: `🚀 CmdBar triggered execution for command: \`${cmdName}\` in workspace \`${ws.name}\`.`,
      };
    }

    return {
      response_type: "ephemeral",
      text: `Unknown sub-command '${subCmd}'. Available: \`list\`, \`stats\`, \`exec <command>\`.`,
    };
  }

  /**
   * Appends entry to workspace audit log.
   * @internal
   */
  _logAudit(ws, actorId, action, details) {
    if (!Array.isArray(ws.auditLogs)) ws.auditLogs = [];
    ws.auditLogs.push({
      id: this._generateId("audit"),
      timestamp: new Date().toISOString(),
      actorId,
      action,
      details,
    });
  }
}
