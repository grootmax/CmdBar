/**
 * Team Command Sharing and Collaboration Module for CmdBar.
 * Features:
 * - URL sharing (export, parse, import via URL schema/HTTPS link)
 * - Team repository management
 * - Version control for configs (history, diff, rollback)
 * - Role-based access control (RBAC)
 * - Approval workflows for team command submissions
 * - Activity feed logging and querying
 */

export const ROLES = {
  ADMIN: "admin",
  APPROVER: "approver",
  EDITOR: "editor",
  VIEWER: "viewer",
};

export const PERMISSIONS = {
  admin: [
    "view",
    "execute",
    "share",
    "create",
    "edit",
    "delete",
    "publish_team",
    "approve",
    "manage_roles",
    "rollback",
    "import_command",
  ],
  approver: [
    "view",
    "execute",
    "share",
    "create",
    "edit",
    "delete",
    "publish_team",
    "approve",
    "import_command",
  ],
  editor: [
    "view",
    "execute",
    "share",
    "create",
    "edit",
    "publish_team",
    "import_command",
  ],
  viewer: ["view", "execute"],
};

/**
 * Checks whether a given role has permission for an action.
 * @param {string} role - The role to check (admin, approver, editor, viewer).
 * @param {string} action - The action identifier (e.g. 'share', 'approve', 'edit').
 * @returns {boolean} True if authorized, false otherwise.
 * @public
 */
export function checkPermission(role, action) {
  if (!role || typeof role !== "string") return false;
  const normalizedRole = role.toLowerCase();
  const allowed = PERMISSIONS[normalizedRole];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(action);
}

/**
 * Enforces permission for a given role and action, throwing an Error if denied.
 * @param {string} role - The role to verify.
 * @param {string} action - The action identifier to verify.
 * @throws {Error} If permission is denied.
 * @public
 */
export function enforcePermission(role, action) {
  if (!checkPermission(role, action)) {
    throw new Error(`Permission denied: Role '${role}' is not authorized for '${action}'`);
  }
}

/**
 * Encodes string to URL-safe base64.
 * @param {string} str - String to encode.
 * @returns {string} Encoded string.
 */
function encodePayload(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64url");
  }
  return encodeURIComponent(str);
}

/**
 * Decodes string from URL-safe base64.
 * @param {string} str - Encoded payload.
 * @returns {string} Decodes string.
 */
function decodePayload(str) {
  if (typeof Buffer !== "undefined") {
    try {
      return Buffer.from(str, "base64url").toString("utf8");
    } catch (e) {
      return Buffer.from(str, "base64").toString("utf8");
    }
  }
  return decodeURIComponent(str);
}

/**
 * Exports a command object to a shareable URL string.
 * @param {object} commandObj - The command object containing name and command string.
 * @param {object} [options] - Export options including author, repositoryId, protocol, timestamp.
 * @returns {string} The formatted share URL.
 * @public
 */
export function exportCommandToUrl(commandObj, options = {}) {
  if (!commandObj || typeof commandObj !== "object" || !commandObj.name || !commandObj.command) {
    throw new Error("Invalid command object for export: name and command are required");
  }

  const payload = {
    v: 1,
    type: "command",
    data: {
      name: String(commandObj.name).trim(),
      command: String(commandObj.command).trim(),
      placeholder: commandObj.placeholder || "",
      category: commandObj.category || "Shared",
      metadata: commandObj.metadata || {},
    },
    author: options.author || "anonymous",
    repositoryId: options.repositoryId || "default",
    timestamp: options.timestamp || Date.now(),
  };

  const jsonStr = JSON.stringify(payload);
  const encoded = encodePayload(jsonStr);
  const protocol = options.protocol || "cmdbar://share";
  return `${protocol}?data=${encoded}`;
}

/**
 * Exports a team repository or collection of commands to a shareable URL string.
 * @param {Array<object>|object} repository - The repository array or object payload.
 * @param {object} [options] - Optional export options.
 * @returns {string} The formatted share URL string.
 * @public
 */
export function exportRepositoryToUrl(repository, options = {}) {
  if (!repository) {
    throw new Error("Invalid repository payload for export");
  }

  const payload = {
    v: 1,
    type: "repository",
    data: repository,
    author: options.author || "anonymous",
    repositoryId: options.repositoryId || "team-repo",
    timestamp: options.timestamp || Date.now(),
  };

  const jsonStr = JSON.stringify(payload);
  const encoded = encodePayload(jsonStr);
  const protocol = options.protocol || "cmdbar://share";
  return `${protocol}?data=${encoded}`;
}

/**
 * Parses and validates a share URL string.
 * @param {string} urlStr - The share URL string.
 * @returns {object} The parsed and decoded payload object.
 * @public
 */
export function parseShareUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") {
    throw new Error("Invalid URL string");
  }

  let dataParam = "";
  if (urlStr.includes("data=")) {
    try {
      const normalizedUrl = urlStr.startsWith("cmdbar://") 
        ? urlStr.replace("cmdbar://", "http://cmdbar/") 
        : urlStr;
      const urlObj = new URL(normalizedUrl);
      dataParam = urlObj.searchParams.get("data") || "";
    } catch (e) {
      const idx = urlStr.indexOf("data=");
      dataParam = urlStr.substring(idx + 5).split("&")[0];
    }
  } else if (urlStr.startsWith("cmdbar://") || urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
    throw new Error("Missing data parameter in share URL");
  } else {
    dataParam = urlStr;
  }

  if (!dataParam) {
    throw new Error("Missing data parameter in share URL");
  }

  let jsonStr;
  try {
    jsonStr = decodePayload(dataParam);
  } catch (e) {
    throw new Error(`Failed to decode URL payload: ${e.message}`);
  }

  let payload;
  try {
    payload = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("Invalid JSON in URL payload");
  }

  if (!payload || typeof payload !== "object" || !payload.type || !payload.data) {
    throw new Error("Malformed payload structure");
  }

  return payload;
}

/**
 * Activity Feed Logger and Query Manager.
 */
export class ActivityFeedManager {
  /**
   * Constructs ActivityFeedManager instance.
   * @param {string} [storagePath] - Optional path to file storage for activity events.
   */
  constructor(storagePath) {
    this.storagePath = storagePath || null;
    this._inMemoryFeed = [];
  }

  /**
   * Logs an activity event.
   * @param {string} action - Action type identifier.
   * @param {string} actor - Name or ID of user or system performing the action.
   * @param {object} [details] - Details object associated with event.
   * @param {string} [repositoryId] - Target repository ID.
   * @returns {Promise<object>} The created activity entry.
   * @public
   */
  async logActivity(action, actor, details = {}, repositoryId = "default") {
    const entry = {
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      action,
      actor: actor || "system",
      details,
      repositoryId,
    };

    this._inMemoryFeed.unshift(entry);

    if (this.storagePath) {
      await this._saveFeed();
    }

    return entry;
  }

  /**
   * Retrieves filtered activity feed events.
   * @param {object} [options] - Filter options (actor, action, repositoryId, since, limit).
   * @returns {Promise<Array<object>>} List of matching activity entries.
   * @public
   */
  async getActivityFeed(options = {}) {
    if (this.storagePath) {
      await this._loadFeed();
    }

    let feed = [...this._inMemoryFeed];

    if (options.actor) {
      feed = feed.filter((e) => e.actor === options.actor);
    }
    if (options.action) {
      feed = feed.filter((e) => e.action === options.action);
    }
    if (options.repositoryId) {
      feed = feed.filter((e) => e.repositoryId === options.repositoryId);
    }
    if (options.since) {
      feed = feed.filter((e) => e.timestamp >= options.since);
    }
    if (options.limit && typeof options.limit === "number") {
      feed = feed.slice(0, options.limit);
    }

    return feed;
  }

  /**
   * Clears all activity feed entries.
   * @returns {Promise<void>}
   * @public
   */
  async clearFeed() {
    this._inMemoryFeed = [];
    if (this.storagePath) {
      await this._saveFeed();
    }
  }

  /**
   * Loads activity feed from disk.
   * @returns {Promise<void>}
   * @private
   */
  async _loadFeed() {
    if (!this.storagePath) return;
    try {
      const fs = await import("fs");
      if (fs.existsSync(this.storagePath)) {
        const content = await fs.promises.readFile(this.storagePath, "utf8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this._inMemoryFeed = parsed;
        }
      }
    } catch (e) {}
  }

  /**
   * Saves activity feed to disk.
   * @returns {Promise<void>}
   * @private
   */
  async _saveFeed() {
    if (!this.storagePath) return;
    try {
      const fs = await import("fs");
      const pathModule = await import("path");
      await fs.promises.mkdir(pathModule.dirname(this.storagePath), { recursive: true });
      await fs.promises.writeFile(this.storagePath, JSON.stringify(this._inMemoryFeed, null, 2), "utf8");
    } catch (e) {}
  }
}

/**
 * Configuration Version Control and Snapshot History Manager.
 */
export class ConfigVersionControl {
  /**
   * Constructs ConfigVersionControl instance.
   * @param {string} [historyPath] - Optional path to file storage for revision history.
   */
  constructor(historyPath) {
    this.historyPath = historyPath || null;
    this._revisions = [];
  }

  /**
   * Records a new configuration revision snapshot.
   * @param {object} config - The full configuration snapshot object.
   * @param {string} [author] - User or system authoring the change.
   * @param {string} [summary] - Brief description of the change.
   * @returns {Promise<object>} The newly recorded revision entry.
   * @public
   */
  async recordRevision(config, author = "system", summary = "Config update") {
    await this._loadHistory();

    const versionNum = this._revisions.length + 1;
    const revision = {
      revisionId: `rev_${versionNum}_${Date.now()}`,
      version: versionNum,
      timestamp: Date.now(),
      author,
      summary,
      snapshot: JSON.parse(JSON.stringify(config)),
    };

    this._revisions.push(revision);
    await this._saveHistory();
    return revision;
  }

  /**
   * Retrieves summary list of revision history entries.
   * @returns {Promise<Array<object>>} List of revision metadata summaries.
   * @public
   */
  async getHistory() {
    await this._loadHistory();
    return this._revisions.map((r) => ({
      revisionId: r.revisionId,
      version: r.version,
      timestamp: r.timestamp,
      author: r.author,
      summary: r.summary,
    }));
  }

  /**
   * Retrieves full revision data by ID.
   * @param {string} revisionId - ID of revision to fetch.
   * @returns {Promise<object|null>} Revision record or null if not found.
   * @public
   */
  async getRevision(revisionId) {
    await this._loadHistory();
    const rev = this._revisions.find((r) => r.revisionId === revisionId);
    return rev ? JSON.parse(JSON.stringify(rev)) : null;
  }

  /**
   * Calculates command additions, modifications, and removals between two revisions.
   * @param {string} revId1 - Older revision ID.
   * @param {string} revId2 - Newer revision ID.
   * @returns {Promise<object>} Object with { added: [], modified: [], removed: [] }.
   * @public
   */
  async diffRevisions(revId1, revId2) {
    const rev1 = await this.getRevision(revId1);
    const rev2 = await this.getRevision(revId2);

    if (!rev1 || !rev2) {
      throw new Error("One or both revisions not found");
    }

    const extractCommands = (rev) => {
      const cmds = [];
      const cats = (rev.snapshot && rev.snapshot.categories) || [];
      for (const cat of cats) {
        for (const cmd of cat.commands || []) {
          cmds.push({ ...cmd, category: cat.name });
        }
      }
      return cmds;
    };

    const cmds1 = extractCommands(rev1);
    const cmds2 = extractCommands(rev2);

    const map1 = new Map(cmds1.map((c) => [c.name, c]));
    const map2 = new Map(cmds2.map((c) => [c.name, c]));

    const added = [];
    const modified = [];
    const removed = [];

    for (const [name, c2] of map2.entries()) {
      if (!map1.has(name)) {
        added.push(c2);
      } else {
        const c1 = map1.get(name);
        if (c1.command !== c2.command || c1.placeholder !== c2.placeholder || c1.category !== c2.category) {
          modified.push({ before: c1, after: c2 });
        }
      }
    }

    for (const [name, c1] of map1.entries()) {
      if (!map2.has(name)) {
        removed.push(c1);
      }
    }

    return { added, modified, removed };
  }

  /**
   * Loads revision history from disk.
   * @returns {Promise<void>}
   * @private
   */
  async _loadHistory() {
    if (!this.historyPath) return;
    try {
      const fs = await import("fs");
      if (fs.existsSync(this.historyPath)) {
        const content = await fs.promises.readFile(this.historyPath, "utf8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this._revisions = parsed;
        }
      }
    } catch (e) {}
  }

  /**
   * Saves revision history to disk.
   * @returns {Promise<void>}
   * @private
   */
  async _saveHistory() {
    if (!this.historyPath) return;
    try {
      const fs = await import("fs");
      const pathModule = await import("path");
      await fs.promises.mkdir(pathModule.dirname(this.historyPath), { recursive: true });
      await fs.promises.writeFile(this.historyPath, JSON.stringify(this._revisions, null, 2), "utf8");
    } catch (e) {}
  }
}

/**
 * Approval Workflow Manager for team command proposals.
 */
export class ApprovalWorkflowManager {
  /**
   * Constructs ApprovalWorkflowManager instance.
   * @param {string} [storagePath] - Optional path to file storage for submissions.
   * @param {ActivityFeedManager} [activityFeedManager] - Activity feed instance.
   */
  constructor(storagePath, activityFeedManager) {
    this.storagePath = storagePath || null;
    this.activityFeedManager = activityFeedManager || null;
    this._submissions = [];
  }

  /**
   * Submits a command or change proposal for team approval.
   * @param {object} submissionData - Submission payload containing command, submitter, etc.
   * @returns {Promise<object>} The created pending submission entry.
   * @public
   */
  async submitForApproval(submissionData) {
    await this._loadSubmissions();

    if (!submissionData || !submissionData.command) {
      throw new Error("Invalid submission data: command is required");
    }

    const submission = {
      submissionId: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      command: submissionData.command,
      category: submissionData.category || "Team Commands",
      repositoryId: submissionData.repositoryId || "default",
      submitter: submissionData.submitter || "anonymous",
      submitterRole: submissionData.submitterRole || ROLES.EDITOR,
      notes: submissionData.notes || "",
      status: "pending",
      submittedAt: Date.now(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    };

    this._submissions.push(submission);
    await this._saveSubmissions();

    if (this.activityFeedManager) {
      await this.activityFeedManager.logActivity(
        "PROPOSAL_SUBMITTED",
        submission.submitter,
        {
          submissionId: submission.submissionId,
          commandName: submission.command.name,
        },
        submission.repositoryId
      );
    }

    return submission;
  }

  /**
   * Gets list of pending command proposals awaiting review.
   * @returns {Promise<Array<object>>} List of pending submission records.
   * @public
   */
  async getPendingSubmissions() {
    await this._loadSubmissions();
    return this._submissions.filter((s) => s.status === "pending");
  }

  /**
   * Approves a pending team submission.
   * @param {string} submissionId - The submission ID.
   * @param {string} reviewer - The reviewer user name or ID.
   * @param {string} reviewerRole - The reviewer role (must have approve permission).
   * @param {string} [notes] - Optional reviewer notes.
   * @returns {Promise<object>} The updated submission object.
   * @public
   */
  async approveSubmission(submissionId, reviewer, reviewerRole, notes = "") {
    enforcePermission(reviewerRole, "approve");
    await this._loadSubmissions();

    const sub = this._submissions.find((s) => s.submissionId === submissionId);
    if (!sub) {
      throw new Error(`Submission '${submissionId}' not found`);
    }

    if (sub.status !== "pending") {
      throw new Error(`Submission '${submissionId}' is already ${sub.status}`);
    }

    sub.status = "approved";
    sub.reviewedBy = reviewer || "approver";
    sub.reviewedAt = Date.now();
    sub.reviewNotes = notes;

    await this._saveSubmissions();

    if (this.activityFeedManager) {
      await this.activityFeedManager.logActivity(
        "PROPOSAL_APPROVED",
        reviewer,
        {
          submissionId: sub.submissionId,
          commandName: sub.command.name,
          notes,
        },
        sub.repositoryId
      );
    }

    return sub;
  }

  /**
   * Rejects a pending team submission.
   * @param {string} submissionId - The submission ID.
   * @param {string} reviewer - The reviewer user name or ID.
   * @param {string} reviewerRole - The reviewer role (must have approve permission).
   * @param {string} [reason] - Rejection reason explanation.
   * @returns {Promise<object>} The updated submission object.
   * @public
   */
  async rejectSubmission(submissionId, reviewer, reviewerRole, reason = "") {
    enforcePermission(reviewerRole, "approve");
    await this._loadSubmissions();

    const sub = this._submissions.find((s) => s.submissionId === submissionId);
    if (!sub) {
      throw new Error(`Submission '${submissionId}' not found`);
    }

    if (sub.status !== "pending") {
      throw new Error(`Submission '${submissionId}' is already ${sub.status}`);
    }

    sub.status = "rejected";
    sub.reviewedBy = reviewer || "approver";
    sub.reviewedAt = Date.now();
    sub.reviewNotes = reason;

    await this._saveSubmissions();

    if (this.activityFeedManager) {
      await this.activityFeedManager.logActivity(
        "PROPOSAL_REJECTED",
        reviewer,
        {
          submissionId: sub.submissionId,
          commandName: sub.command.name,
          reason,
        },
        sub.repositoryId
      );
    }

    return sub;
  }

  /**
   * Loads submissions from disk.
   * @returns {Promise<void>}
   * @private
   */
  async _loadSubmissions() {
    if (!this.storagePath) return;
    try {
      const fs = await import("fs");
      if (fs.existsSync(this.storagePath)) {
        const content = await fs.promises.readFile(this.storagePath, "utf8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this._submissions = parsed;
        }
      }
    } catch (e) {}
  }

  /**
   * Saves submissions to disk.
   * @returns {Promise<void>}
   * @private
   */
  async _saveSubmissions() {
    if (!this.storagePath) return;
    try {
      const fs = await import("fs");
      const pathModule = await import("path");
      await fs.promises.mkdir(pathModule.dirname(this.storagePath), { recursive: true });
      await fs.promises.writeFile(this.storagePath, JSON.stringify(this._submissions, null, 2), "utf8");
    } catch (e) {}
  }
}

/**
 * Team Command Repository Manager.
 */
export class TeamRepositoryManager {
  /**
   * Constructs TeamRepositoryManager instance.
   * @param {string} [storagePath] - Optional path to file storage for team repositories.
   * @param {ApprovalWorkflowManager} [approvalWorkflowManager] - Approval manager instance.
   * @param {ActivityFeedManager} [activityFeedManager] - Activity feed instance.
   * @param {ConfigVersionControl} [versionControl] - Version control instance.
   */
  constructor(storagePath, approvalWorkflowManager, activityFeedManager, versionControl) {
    this.storagePath = storagePath || null;
    this.approvalWorkflowManager = approvalWorkflowManager || null;
    this.activityFeedManager = activityFeedManager || null;
    this.versionControl = versionControl || null;
    this._repositories = new Map();
  }

  /**
   * Creates or registers a team repository.
   * @param {object} repoData - Repository data { id, name, description, owner, commands }.
   * @param {string} [userRole] - User role creating the repository.
   * @returns {Promise<object>} Created repository object.
   * @public
   */
  async createRepository(repoData, userRole = ROLES.ADMIN) {
    enforcePermission(userRole, "publish_team");
    await this._loadRepositories();

    if (!repoData || !repoData.id || !repoData.name) {
      throw new Error("Repository id and name are required");
    }

    const repo = {
      id: repoData.id,
      name: repoData.name,
      description: repoData.description || "",
      owner: repoData.owner || "system",
      created_at: Date.now(),
      updated_at: Date.now(),
      commands: repoData.commands || [],
    };

    this._repositories.set(repo.id, repo);
    await this._saveRepositories();

    if (this.activityFeedManager) {
      await this.activityFeedManager.logActivity(
        "REPOSITORY_CREATED",
        repo.owner,
        { repositoryId: repo.id, name: repo.name },
        repo.id
      );
    }

    return repo;
  }

  /**
   * Fetches repository data by ID.
   * @param {string} repoId - Repository identifier.
   * @returns {Promise<object|null>} Repository or null if not found.
   * @public
   */
  async getRepository(repoId) {
    await this._loadRepositories();
    const repo = this._repositories.get(repoId);
    return repo ? JSON.parse(JSON.stringify(repo)) : null;
  }

  /**
   * Lists all registered team repositories.
   * @returns {Promise<Array<object>>} Array of repository objects.
   * @public
   */
  async listRepositories() {
    await this._loadRepositories();
    return Array.from(this._repositories.values()).map((r) => JSON.parse(JSON.stringify(r)));
  }

  /**
   * Publishes or proposes a command for a team repository.
   * @param {string} repoId - Repository identifier.
   * @param {object} commandObj - Command object.
   * @param {string} [userRole] - User role.
   * @param {string} [author] - Author user name.
   * @param {object} [options] - Options (requireApproval, notes).
   * @returns {Promise<object>} Status object or submission payload.
   * @public
   */
  async publishCommand(repoId, commandObj, userRole = ROLES.EDITOR, author = "anonymous", options = {}) {
    enforcePermission(userRole, "publish_team");
    await this._loadRepositories();

    const repo = this._repositories.get(repoId);
    if (!repo) {
      throw new Error(`Team repository '${repoId}' not found`);
    }

    const needsApproval = options.requireApproval || userRole === ROLES.EDITOR;

    if (needsApproval && this.approvalWorkflowManager) {
      return await this.approvalWorkflowManager.submitForApproval({
        command: commandObj,
        category: commandObj.category || "Team Commands",
        repositoryId: repoId,
        submitter: author,
        submitterRole: userRole,
        notes: options.notes || "Proposed team command",
      });
    }

    const teamCommand = {
      ...commandObj,
      isTeamCommand: true,
      repositoryId: repoId,
      author,
      publishedAt: Date.now(),
    };

    repo.commands.push(teamCommand);
    repo.updated_at = Date.now();

    await this._saveRepositories();

    if (this.activityFeedManager) {
      await this.activityFeedManager.logActivity(
        "COMMAND_PUBLISHED",
        author,
        { repositoryId: repoId, commandName: commandObj.name },
        repoId
      );
    }

    return { status: "published", command: teamCommand };
  }

  /**
   * Loads repositories from disk.
   * @returns {Promise<void>}
   * @private
   */
  async _loadRepositories() {
    if (!this.storagePath) return;
    try {
      const fs = await import("fs");
      if (fs.existsSync(this.storagePath)) {
        const content = await fs.promises.readFile(this.storagePath, "utf8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this._repositories.clear();
          for (const r of parsed) {
            this._repositories.set(r.id, r);
          }
        }
      }
    } catch (e) {}
  }

  /**
   * Saves repositories to disk.
   * @returns {Promise<void>}
   * @private
   */
  async _saveRepositories() {
    if (!this.storagePath) return;
    try {
      const fs = await import("fs");
      const pathModule = await import("path");
      await fs.promises.mkdir(pathModule.dirname(this.storagePath), { recursive: true });
      const list = Array.from(this._repositories.values());
      await fs.promises.writeFile(this.storagePath, JSON.stringify(list, null, 2), "utf8");
    } catch (e) {}
  }
}

/**
 * Main Service class for Team Command Sharing, combining all sub-managers.
 */
export class TeamSharingService {
  /**
   * Constructs TeamSharingService instance.
   * @param {object} [config] - Configuration parameters (baseDir, userRole, userName).
   */
  constructor(config = {}) {
    this.baseDir = config.baseDir || "/tmp/cmdbar-team";
    this.userRole = config.userRole || ROLES.EDITOR;
    this.userName = config.userName || "local_user";

    const pathJoin = (p) => `${this.baseDir}/${p}`;

    this.activityFeed = new ActivityFeedManager(pathJoin("activity.json"));
    this.versionControl = new ConfigVersionControl(pathJoin("history.json"));
    this.approvalWorkflow = new ApprovalWorkflowManager(pathJoin("approvals.json"), this.activityFeed);
    this.repositoryManager = new TeamRepositoryManager(
      pathJoin("repositories.json"),
      this.approvalWorkflow,
      this.activityFeed,
      this.versionControl
    );
  }

  /**
   * Shares a command object by exporting it to a URL string.
   * @param {object} commandObj - Command to share.
   * @param {string} [role] - User role.
   * @returns {Promise<string>} Share URL string.
   * @public
   */
  async shareCommand(commandObj, role = this.userRole) {
    enforcePermission(role, "share");
    const url = exportCommandToUrl(commandObj, { author: this.userName });
    await this.activityFeed.logActivity("COMMAND_SHARED", this.userName, { commandName: commandObj.name });
    return url;
  }

  /**
   * Imports commands from a share URL into a configuration object.
   * @param {string} urlStr - Share URL string.
   * @param {object} [config] - Target config layout object.
   * @param {string} [role] - User role.
   * @returns {Promise<object>} Object containing { config, status, message }.
   * @public
   */
  async importFromUrl(urlStr, config = { categories: [] }, role = this.userRole) {
    enforcePermission(role, "import_command");
    const payload = parseShareUrl(urlStr);

    let targetConfig = JSON.parse(JSON.stringify(config));
    if (!targetConfig.categories) {
      targetConfig.categories = [];
    }

    if (payload.type === "command") {
      const cmd = payload.data;
      const catName = cmd.category || "Shared Commands";
      let cat = targetConfig.categories.find((c) => c.name === catName);
      if (!cat) {
        cat = { name: catName, commands: [] };
        targetConfig.categories.push(cat);
      }
      cat.commands = cat.commands || [];
      cat.commands.push({
        name: cmd.name,
        command: cmd.command,
        placeholder: cmd.placeholder || "",
        isShared: true,
        sharedBy: payload.author,
      });

      await this.activityFeed.logActivity("COMMAND_IMPORTED", this.userName, {
        commandName: cmd.name,
        fromAuthor: payload.author,
      });

      await this.versionControl.recordRevision(targetConfig, this.userName, `Imported '${cmd.name}' via URL`);

      return { config: targetConfig, status: "imported", message: `Successfully imported '${cmd.name}'` };
    } else if (payload.type === "repository") {
      const repoData = payload.data;
      if (Array.isArray(repoData)) {
        for (const item of repoData) {
          if (item.name && item.commands) {
            let cat = targetConfig.categories.find((c) => c.name === item.name);
            if (!cat) {
              cat = { name: item.name, commands: [] };
              targetConfig.categories.push(cat);
            }
            cat.commands.push(...item.commands);
          }
        }
      }
      await this.activityFeed.logActivity("REPOSITORY_IMPORTED", this.userName, {
        fromAuthor: payload.author,
      });
      await this.versionControl.recordRevision(targetConfig, this.userName, "Imported repository via URL");
      return { config: targetConfig, status: "imported", message: "Successfully imported repository" };
    }

    throw new Error(`Unsupported payload type '${payload.type}'`);
  }
}
