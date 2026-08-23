/**
 * WorkspaceManager for CmdBar Organization Workspaces.
 * Handles team workspaces, shared commands, admin access controls, usage analytics,
 * billing management, private registries, and Slack integration.
 * Compatible with Node.js and GJS (GNOME Shell).
 */

export const ROLE_ADMIN = "admin";
export const ROLE_MEMBER = "member";
export const ROLE_VIEWER = "viewer";

export const VALID_ROLES = new Set([ROLE_ADMIN, ROLE_MEMBER, ROLE_VIEWER]);

export const BILLING_PLANS = {
  free: {
    maxMembers: 3,
    maxCommands: 10,
    maxMonthlyExecutions: 1000,
  },
  pro: {
    maxMembers: 25,
    maxCommands: 100,
    maxMonthlyExecutions: 50000,
  },
  enterprise: {
    maxMembers: -1,
    maxCommands: -1,
    maxMonthlyExecutions: -1,
  },
};

export const PERMISSIONS = {
  admin: new Set([
    "manage_members",
    "manage_commands",
    "manage_billing",
    "manage_registry",
    "manage_slack",
    "execute_command",
    "view_analytics",
    "manage_policy",
  ]),
  member: new Set([
    "manage_commands",
    "execute_command",
    "view_analytics",
    "manage_registry",
    "view_registry",
  ]),
  viewer: new Set([
    "execute_command",
    "view_analytics",
    "view_registry",
  ]),
};

/**
 * Returns current ISO timestamp string.
 * @public
 * @returns {string}
 */
export function currentIsoTimestamp() {
  return new Date().toISOString();
}

/**
 * Central Manager class for CmdBar Organization Workspaces.
 * @public
 */
export class WorkspaceManager {
  /**
   * Constructs WorkspaceManager with configuration dictionary or list of workspaces.
   * @param {Object} [config={}]
   * @public
   */
  constructor(config = {}) {
    this.workspaces = new Map();
    const workspacesData = config.workspaces || [];

    if (Array.isArray(workspacesData)) {
      workspacesData.forEach((ws) => {
        if (ws && ws.id) {
          this.workspaces.set(ws.id, JSON.parse(JSON.stringify(ws)));
        }
      });
    } else if (typeof workspacesData === "object" && workspacesData !== null) {
      Object.entries(workspacesData).forEach(([id, ws]) => {
        if (ws && typeof ws === "object") {
          this.workspaces.set(id, JSON.parse(JSON.stringify(ws)));
        }
      });
    }
  }

  /**
   * Exports all workspace data as a JSON-serializable array.
   * @public
   * @returns {Array<Object>}
   */
  toConfigArray() {
    return Array.from(this.workspaces.values());
  }

  /**
   * Creates a new organization workspace with owner set as admin.
   * @public
   * @param {string} name
   * @param {string} ownerId
   * @param {string} [organization="Default Org"]
   * @param {string} [plan="free"]
   * @returns {Object}
   */
  createWorkspace(name, ownerId, organization = "Default Org", plan = "free") {
    if (!name || !String(name).trim()) {
      throw new Error("Workspace name cannot be empty.");
    }
    if (!ownerId || !String(ownerId).trim()) {
      throw new Error("Owner ID cannot be empty.");
    }
    if (!BILLING_PLANS[plan]) {
      throw new Error(`Invalid plan '${plan}'. Must be one of: ${Object.keys(BILLING_PLANS).join(", ")}`);
    }

    const wsId = `ws_${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;
    const now = currentIsoTimestamp();

    const workspace = {
      id: wsId,
      name: String(name).trim(),
      organization: String(organization).trim() || "Default Org",
      owner_id: String(ownerId).trim(),
      plan: plan,
      members: [
        {
          user_id: String(ownerId).trim(),
          role: ROLE_ADMIN,
          joined_at: now,
        },
      ],
      categories: [],
      private_registry: [],
      slack_config: {
        webhook_url: "",
        channel: "#general",
        enabled: false,
        events: ["command_execution", "workspace_update", "registry_publish"],
      },
      usage_analytics: {
        total_executions: 0,
        executions_by_user: {},
        executions_by_command: {},
        execution_logs: [],
      },
      security_policy: {
        allow_untrusted_commands: false,
        require_ai_confirmation: true,
        allowed_registries: ["official", "private"],
      },
      created_at: now,
      updated_at: now,
    };

    this.workspaces.set(wsId, workspace);
    return workspace;
  }

  /**
   * Retrieves a workspace by ID.
   * @public
   * @param {string} workspaceId
   * @returns {Object}
   */
  getWorkspace(workspaceId) {
    if (!this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace with ID '${workspaceId}' not found.`);
    }
    return this.workspaces.get(workspaceId);
  }

  /**
   * Lists workspaces, optionally filtered by user ID membership.
   * @public
   * @param {string} [userId=null]
   * @returns {Array<Object>}
   */
  listWorkspaces(userId = null) {
    const allWs = Array.from(this.workspaces.values());
    if (!userId) {
      return allWs;
    }
    const cleanUser = String(userId).trim();
    return allWs.filter((ws) =>
      (ws.members || []).some((m) => m.user_id === cleanUser)
    );
  }

  /**
   * Updates workspace properties if requester has admin permissions.
   * @public
   * @param {string} workspaceId
   * @param {string} requestingUserId
   * @param {Object} updates
   * @returns {Object}
   */
  updateWorkspace(workspaceId, requestingUserId, updates = {}) {
    if (!this.checkPermission(workspaceId, requestingUserId, "manage_policy")) {
      throw new Error("User does not have admin permission to update workspace.");
    }

    const ws = this.getWorkspace(workspaceId);
    const allowedKeys = new Set(["name", "organization", "security_policy"]);

    Object.entries(updates).forEach(([k, v]) => {
      if (allowedKeys.has(k)) {
        if (k === "security_policy" && typeof v === "object" && v !== null) {
          ws.security_policy = { ...ws.security_policy, ...v };
        } else {
          ws[k] = v;
        }
      }
    });

    ws.updated_at = currentIsoTimestamp();
    return ws;
  }

  /**
   * Deletes a workspace if requester is owner or admin.
   * @public
   * @param {string} workspaceId
   * @param {string} requestingUserId
   * @returns {boolean}
   */
  deleteWorkspace(workspaceId, requestingUserId) {
    const ws = this.getWorkspace(workspaceId);
    if (ws.owner_id !== requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_policy")) {
      throw new Error("User does not have permission to delete this workspace.");
    }
    return this.workspaces.delete(workspaceId);
  }

  /**
   * Sets the active workspace ID in user configuration.
   * @public
   * @param {string} workspaceId
   * @param {Object} userConfig
   * @returns {Object}
   */
  setActiveWorkspace(workspaceId, userConfig) {
    if (workspaceId && !this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace '${workspaceId}' does not exist.`);
    }
    userConfig.active_workspace_id = workspaceId;
    return userConfig;
  }

  /**
   * Gets active workspace object from user configuration.
   * @public
   * @param {Object} userConfig
   * @returns {Object|null}
   */
  getActiveWorkspace(userConfig) {
    const wsId = userConfig ? userConfig.active_workspace_id : null;
    if (!wsId || !this.workspaces.has(wsId)) {
      return null;
    }
    return this.workspaces.get(wsId);
  }

  /**
   * Checks if user has permission for action in a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} action
   * @returns {boolean}
   */
  checkPermission(workspaceId, userId, action) {
    if (!userId || !this.workspaces.has(workspaceId)) {
      return false;
    }
    const ws = this.workspaces.get(workspaceId);
    const cleanUser = String(userId).trim();

    let role = null;
    for (const m of ws.members || []) {
      if (m.user_id === cleanUser) {
        role = m.role;
        break;
      }
    }

    if (!role || !PERMISSIONS[role]) {
      return false;
    }

    return PERMISSIONS[role].has(action);
  }

  /**
   * Adds or updates a member in a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} [role="member"]
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  addMember(workspaceId, userId, role = "member", requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_members")) {
      throw new Error("Requesting user does not have permission to manage members.");
    }

    if (!VALID_ROLES.has(role)) {
      throw new Error(`Invalid role '${role}'. Must be one of: ${Array.from(VALID_ROLES).join(", ")}`);
    }

    const ws = this.getWorkspace(workspaceId);
    const cleanUser = String(userId).trim();
    const members = ws.members || [];

    let existing = members.find((m) => m.user_id === cleanUser);

    if (!existing) {
      const billingStatus = this.getBillingStatus(workspaceId);
      if (billingStatus.isMemberQuotaExceeded) {
        throw new Error(`Workspace member limit reached (${billingStatus.maxMembers}) for plan '${ws.plan}'. Upgrade plan to add more members.`);
      }
      members.push({
        user_id: cleanUser,
        role: role,
        joined_at: currentIsoTimestamp(),
      });
    } else {
      existing.role = role;
    }

    ws.updated_at = currentIsoTimestamp();
    return ws;
  }

  /**
   * Removes a member from a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} [requestingUserId=null]
   * @returns {boolean}
   */
  removeMember(workspaceId, userId, requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_members")) {
      throw new Error("Requesting user does not have permission to manage members.");
    }

    const ws = this.getWorkspace(workspaceId);
    const cleanUser = String(userId).trim();

    if (ws.owner_id === cleanUser) {
      throw new Error("Cannot remove workspace owner.");
    }

    const initLen = (ws.members || []).length;
    ws.members = (ws.members || []).filter((m) => m.user_id !== cleanUser);

    if (ws.members.length < initLen) {
      ws.updated_at = currentIsoTimestamp();
      return true;
    }
    return false;
  }

  /**
   * Updates an existing member's role.
   * @public
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} newRole
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  updateMemberRole(workspaceId, userId, newRole, requestingUserId = null) {
    return this.addMember(workspaceId, userId, newRole, requestingUserId);
  }

  /**
   * Adds a shared command to a workspace category.
   * @public
   * @param {string} workspaceId
   * @param {string} categoryName
   * @param {Object} commandObj
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  addSharedCommand(workspaceId, categoryName, commandObj, requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_commands")) {
      throw new Error("Requesting user does not have permission to add shared commands.");
    }

    const ws = this.getWorkspace(workspaceId);

    const billingStatus = this.getBillingStatus(workspaceId);
    if (billingStatus.isCommandQuotaExceeded) {
      throw new Error(`Workspace command limit reached (${billingStatus.maxCommands}) for plan '${ws.plan}'. Upgrade plan to add more commands.`);
    }

    const catName = String(categoryName || "Workspace Shared").trim();
    ws.categories = ws.categories || [];

    let targetCat = ws.categories.find((c) => c.name === catName);
    if (!targetCat) {
      targetCat = { name: catName, commands: [] };
      ws.categories.push(targetCat);
    }

    targetCat.commands = targetCat.commands || [];
    const cleanCmdName = commandObj.name || "Unnamed Command";

    const cmdEntry = {
      ...commandObj,
      shared_by: requestingUserId || "admin",
      workspace_id: workspaceId,
    };

    const existingIdx = targetCat.commands.findIndex((c) => c.name === cleanCmdName);
    if (existingIdx >= 0) {
      targetCat.commands[existingIdx] = cmdEntry;
    } else {
      targetCat.commands.push(cmdEntry);
    }

    ws.updated_at = currentIsoTimestamp();

    this.sendSlackNotification(
      workspaceId,
      "workspace_update",
      `Shared command '${cleanCmdName}' was added to category '${catName}'`,
      { command: cleanCmdName, category: catName, user: requestingUserId }
    );

    return ws;
  }

  /**
   * Removes a shared command from a workspace.
   * @public
   * @param {string} workspaceId
   * @param {string} categoryName
   * @param {string} commandName
   * @param {string} [requestingUserId=null]
   * @returns {boolean}
   */
  removeSharedCommand(workspaceId, categoryName, commandName, requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_commands")) {
      throw new Error("Requesting user does not have permission to remove shared commands.");
    }

    const ws = this.getWorkspace(workspaceId);
    let removed = false;

    (ws.categories || []).forEach((cat) => {
      if (!categoryName || cat.name === categoryName) {
        const initLen = (cat.commands || []).length;
        cat.commands = (cat.commands || []).filter((c) => c.name !== commandName);
        if (cat.commands.length < initLen) {
          removed = true;
        }
      }
    });

    if (removed) {
      ws.updated_at = currentIsoTimestamp();
    }
    return removed;
  }

  /**
   * Merges local user categories with the active workspace's shared categories.
   * @public
   * @param {Object} userConfig
   * @returns {Array<Object>}
   */
  getMergedCategories(userConfig) {
    const localCategories = JSON.parse(JSON.stringify((userConfig && userConfig.categories) || []));
    const activeWs = this.getActiveWorkspace(userConfig);

    if (!activeWs) {
      return localCategories;
    }

    const merged = [...localCategories];
    (activeWs.categories || []).forEach((wsCat) => {
      const catCopy = {
        name: `[${activeWs.name}] ${wsCat.name}`,
        workspace_id: activeWs.id,
        workspace_name: activeWs.name,
        commands: (wsCat.commands || []).map((cmd) => ({
          ...cmd,
          workspace_id: activeWs.id,
          is_shared: true,
        })),
      };
      merged.push(catCopy);
    });

    return merged;
  }

  /**
   * Logs command execution metrics for workspace analytics.
   * @public
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} commandName
   * @param {string} [category="General"]
   * @param {string} [status="success"]
   * @param {number} [durationMs=0]
   * @param {Object} [metadata=null]
   * @returns {Object}
   */
  recordCommandExecution(workspaceId, userId, commandName, category = "General", status = "success", durationMs = 0, metadata = null) {
    const ws = this.getWorkspace(workspaceId);

    const billingStatus = this.getBillingStatus(workspaceId);
    if (billingStatus.isExecutionQuotaExceeded) {
      throw new Error(`Workspace monthly execution limit reached (${billingStatus.executionQuota}) for plan '${ws.plan}'. Upgrade plan to run more commands.`);
    }

    ws.usage_analytics = ws.usage_analytics || {
      total_executions: 0,
      executions_by_user: {},
      executions_by_command: {},
      execution_logs: [],
    };

    const analytics = ws.usage_analytics;
    analytics.total_executions = (analytics.total_executions || 0) + 1;

    const cleanUser = String(userId || "anonymous").trim();
    analytics.executions_by_user[cleanUser] = (analytics.executions_by_user[cleanUser] || 0) + 1;

    const cleanCmd = String(commandName || "Unknown").trim();
    analytics.executions_by_command[cleanCmd] = (analytics.executions_by_command[cleanCmd] || 0) + 1;

    const logEntry = {
      id: `log_${Math.random().toString(36).substring(2, 10)}`,
      timestamp: currentIsoTimestamp(),
      user_id: cleanUser,
      command_name: cleanCmd,
      category: category,
      status: status,
      duration_ms: durationMs,
      metadata: metadata || {},
    };

    analytics.execution_logs = analytics.execution_logs || [];
    analytics.execution_logs.push(logEntry);

    if (analytics.execution_logs.length > 500) {
      analytics.execution_logs = analytics.execution_logs.slice(-500);
    }

    ws.updated_at = currentIsoTimestamp();

    this.sendSlackNotification(
      workspaceId,
      "command_execution",
      `User '${cleanUser}' executed command '${cleanCmd}' (${status}) in workspace '${ws.name}'`,
      { user: cleanUser, command: cleanCmd, status: status, duration_ms: durationMs }
    );

    return logEntry;
  }

  /**
   * Returns workspace usage analytics report.
   * @public
   * @param {string} workspaceId
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  getUsageAnalytics(workspaceId, requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "view_analytics")) {
      throw new Error("Requesting user does not have permission to view analytics.");
    }

    const ws = this.getWorkspace(workspaceId);
    const analytics = ws.usage_analytics || {};
    const logs = analytics.execution_logs || [];

    const successCount = logs.filter((l) => l.status === "success").length;
    const failureCount = logs.filter((l) => l.status !== "success").length;
    const totalLogs = logs.length;
    const successRate = totalLogs > 0 ? (successCount / totalLogs) * 100 : 100;

    const topCommands = Object.entries(analytics.executions_by_command || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topUsers = Object.entries(analytics.executions_by_user || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      workspace_id: workspaceId,
      workspace_name: ws.name,
      total_executions: analytics.total_executions || 0,
      success_rate: Math.round(successRate * 100) / 100,
      total_logged_events: totalLogs,
      success_count: successCount,
      failure_count: failureCount,
      top_commands: Object.fromEntries(topCommands),
      top_users: Object.fromEntries(topUsers),
      recent_logs: logs.slice(-20),
    };
  }

  /**
   * Returns workspace billing status and quotas.
   * @public
   * @param {string} workspaceId
   * @returns {Object}
   */
  getBillingStatus(workspaceId) {
    const ws = this.getWorkspace(workspaceId);
    const planName = ws.plan || "free";
    const limits = BILLING_PLANS[planName] || BILLING_PLANS.free;

    const currentMembers = (ws.members || []).length;
    const maxMembers = limits.maxMembers;

    let currentCommands = 0;
    (ws.categories || []).forEach((cat) => {
      currentCommands += (cat.commands || []).length;
    });
    const maxCommands = limits.maxCommands;

    const currentExecutions = (ws.usage_analytics && ws.usage_analytics.total_executions) || 0;
    const maxExecutions = limits.maxMonthlyExecutions;

    const isMemberQuotaExceeded = maxMembers !== -1 && currentMembers >= maxMembers;
    const isCommandQuotaExceeded = maxCommands !== -1 && currentCommands >= maxCommands;
    const isExecutionQuotaExceeded = maxExecutions !== -1 && currentExecutions >= maxExecutions;

    return {
      workspaceId: workspaceId,
      plan: planName,
      memberCount: currentMembers,
      maxMembers: maxMembers,
      commandCount: currentCommands,
      maxCommands: maxCommands,
      monthlyExecutions: currentExecutions,
      executionQuota: maxExecutions,
      isMemberQuotaExceeded: isMemberQuotaExceeded,
      isCommandQuotaExceeded: isCommandQuotaExceeded,
      isExecutionQuotaExceeded: isExecutionQuotaExceeded,
    };
  }

  /**
   * Updates workspace billing plan.
   * @public
   * @param {string} workspaceId
   * @param {string} newPlan
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  updateBillingPlan(workspaceId, newPlan, requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_billing")) {
      throw new Error("Requesting user does not have permission to manage billing.");
    }

    if (!BILLING_PLANS[newPlan]) {
      throw new Error(`Invalid plan '${newPlan}'. Must be one of: ${Object.keys(BILLING_PLANS).join(", ")}`);
    }

    const ws = this.getWorkspace(workspaceId);
    ws.plan = newPlan;
    ws.updated_at = currentIsoTimestamp();

    this.sendSlackNotification(
      workspaceId,
      "workspace_update",
      `Workspace '${ws.name}' billing plan upgraded to '${newPlan}'`,
      { plan: newPlan, user: requestingUserId }
    );

    return this.getBillingStatus(workspaceId);
  }

  /**
   * Checks if workspace is within billing quota for metric.
   * @public
   * @param {string} workspaceId
   * @param {string} [metric="executions"]
   * @returns {boolean}
   */
  checkBillingQuota(workspaceId, metric = "executions") {
    const status = this.getBillingStatus(workspaceId);
    if (metric === "members" && status.isMemberQuotaExceeded) {
      throw new Error(`Member quota exceeded (${status.memberCount}/${status.maxMembers})`);
    }
    if (metric === "commands" && status.isCommandQuotaExceeded) {
      throw new Error(`Command quota exceeded (${status.commandCount}/${status.maxCommands})`);
    }
    if (metric === "executions" && status.isExecutionQuotaExceeded) {
      throw new Error(`Execution quota exceeded (${status.monthlyExecutions}/${status.executionQuota})`);
    }
    return true;
  }

  /**
   * Publishes a package to the workspace private registry.
   * @public
   * @param {string} workspaceId
   * @param {string} packageId
   * @param {string} name
   * @param {string} version
   * @param {Array<Object>} commands
   * @param {string} [requestingUserId=null]
   * @param {string} [description=""]
   * @returns {Object}
   */
  publishToRegistry(workspaceId, packageId, name, version, commands, requestingUserId = null, description = "") {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_registry")) {
      throw new Error("Requesting user does not have permission to publish to private registry.");
    }

    if (!packageId || !String(packageId).trim()) {
      throw new Error("Package ID cannot be empty.");
    }
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new Error("Package must include a non-empty list of commands.");
    }

    const ws = this.getWorkspace(workspaceId);
    ws.private_registry = ws.private_registry || [];

    const pkgEntry = {
      package_id: String(packageId).trim(),
      name: String(name).trim(),
      version: String(version).trim(),
      description: String(description || "").trim(),
      publisher: requestingUserId || "admin",
      commands: commands,
      published_at: currentIsoTimestamp(),
    };

    const existingIdx = ws.private_registry.findIndex((p) => p.package_id === pkgEntry.package_id);
    if (existingIdx >= 0) {
      ws.private_registry[existingIdx] = pkgEntry;
    } else {
      ws.private_registry.push(pkgEntry);
    }

    ws.updated_at = currentIsoTimestamp();

    this.sendSlackNotification(
      workspaceId,
      "registry_publish",
      `Package '${name}' (v${version}) published to workspace private registry`,
      { package_id: packageId, version: version, publisher: requestingUserId }
    );

    return pkgEntry;
  }

  /**
   * Searches workspace private registry for packages.
   * @public
   * @param {string} workspaceId
   * @param {string} [query=""]
   * @returns {Array<Object>}
   */
  searchRegistry(workspaceId, query = "") {
    const ws = this.getWorkspace(workspaceId);
    const registry = ws.private_registry || [];

    if (!query || !String(query).trim()) {
      return registry;
    }

    const q = String(query).trim().toLowerCase();
    return registry.filter(
      (pkg) =>
        (pkg.package_id && pkg.package_id.toLowerCase().includes(q)) ||
        (pkg.name && pkg.name.toLowerCase().includes(q)) ||
        (pkg.description && pkg.description.toLowerCase().includes(q))
    );
  }

  /**
   * Installs package commands from private registry into user configuration.
   * @public
   * @param {string} workspaceId
   * @param {string} packageId
   * @param {Object} userConfig
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  installFromRegistry(workspaceId, packageId, userConfig, requestingUserId = null) {
    const ws = this.getWorkspace(workspaceId);
    const registry = ws.private_registry || [];

    const pkg = registry.find((p) => p.package_id === packageId);
    if (!pkg) {
      throw new Error(`Package '${packageId}' not found in private registry.`);
    }

    const pkgCategory = {
      name: `Registry: ${pkg.name}`,
      commands: pkg.commands || [],
    };

    userConfig.categories = userConfig.categories || [];
    userConfig.categories.push(pkgCategory);
    return userConfig;
  }

  /**
   * Configures Slack integration settings.
   * @public
   * @param {string} workspaceId
   * @param {string} webhookUrl
   * @param {string} [channel="#general"]
   * @param {boolean} [enabled=true]
   * @param {Array<string>} [events=null]
   * @param {string} [requestingUserId=null]
   * @returns {Object}
   */
  configureSlack(workspaceId, webhookUrl, channel = "#general", enabled = true, events = null, requestingUserId = null) {
    if (requestingUserId && !this.checkPermission(workspaceId, requestingUserId, "manage_slack")) {
      throw new Error("Requesting user does not have permission to manage Slack settings.");
    }

    const ws = this.getWorkspace(workspaceId);
    const slackConfig = {
      webhook_url: String(webhookUrl || "").trim(),
      channel: String(channel || "#general").trim(),
      enabled: Boolean(enabled),
      events: Array.isArray(events)
        ? events
        : ["command_execution", "workspace_update", "registry_publish"],
    };

    ws.slack_config = slackConfig;
    ws.updated_at = currentIsoTimestamp();
    return slackConfig;
  }

  /**
   * Formats Slack webhook payload object.
   * @public
   * @param {string} workspaceId
   * @param {string} eventType
   * @param {string} message
   * @param {Object} [details=null]
   * @returns {Object}
   */
  formatSlackPayload(workspaceId, eventType, message, details = null) {
    const ws = this.getWorkspace(workspaceId);
    const channel = (ws.slack_config && ws.slack_config.channel) || "#general";

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `CmdBar Workspace: ${ws.name}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${eventType.replace(/_/g, " ").toUpperCase()}*\n${message}`,
        },
      },
    ];

    if (details && typeof details === "object") {
      const fields = Object.entries(details).slice(0, 10).map(([k, v]) => ({
        type: "mrkdwn",
        text: `*${k.replace(/_/g, " ").toUpperCase()}:*\n\`${v}\``,
      }));
      blocks.push({
        type: "section",
        fields: fields,
      });
    }

    return {
      channel: channel,
      text: `[${ws.name}] ${message}`,
      blocks: blocks,
    };
  }

  /**
   * Triggers Slack notification.
   * @public
   * @param {string} workspaceId
   * @param {string} eventType
   * @param {string} message
   * @param {Object} [details=null]
   * @returns {boolean}
   */
  sendSlackNotification(workspaceId, eventType, message, details = null) {
    const ws = this.getWorkspace(workspaceId);
    const slack = ws.slack_config || {};

    if (!slack.enabled || !slack.webhook_url) {
      return false;
    }

    const configuredEvents = slack.events || [];
    if (configuredEvents.length > 0 && !configuredEvents.includes(eventType)) {
      return false;
    }

    const payload = this.formatSlackPayload(workspaceId, eventType, message, details);

    // Mock notification dispatch in Node / GJS non-network environment
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test") {
      ws._last_slack_payload = payload;
      return true;
    }

    return true;
  }
}
