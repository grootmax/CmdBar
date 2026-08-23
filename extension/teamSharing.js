/**
 * Team Command Sharing, Repository Management, Version Control, Role-Based Access Control (RBAC),
 * Approval Workflows, and Activity Feed Manager.
 *
 * Runs in GJS and Node.js environments.
 */

import { canonicalJson } from "./configSync.js";

const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

let cryptoModule;
if (isNode) {
  try {
    cryptoModule = await import("crypto");
  } catch (e) {
    cryptoModule = null;
  }
}

/**
 * Generates a SHA-256 hash string for the given text.
 * @param {string} text - Input text.
 * @returns {string} SHA-256 hex string.
 * :visibility: public
 */
export function sha256Hex(text) {
  if (cryptoModule && cryptoModule.createHash) {
    return cryptoModule.createHash("sha256").update(text).digest("hex");
  }
  // Simple fallback hash for environments without crypto
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16);
  return hex.padStart(64, "0");
}

/**
 * Defined user roles for Team Command Sharing.
 * :visibility: public
 */
export const ROLES = {
  VIEWER: "viewer",
  EDITOR: "editor",
  APPROVER: "approver",
  ADMIN: "admin",
};

/**
 * Hierarchy levels for RBAC roles.
 * :visibility: public
 */
export const ROLE_LEVELS = {
  viewer: 1,
  editor: 2,
  approver: 3,
  admin: 4,
};

/**
 * Map of permissions required for specific actions.
 * :visibility: public
 */
export const PERMISSIONS = {
  VIEW: "viewer",
  EXECUTE: "viewer",
  SHARE_URL: "viewer",
  IMPORT_URL: "viewer",
  CREATE_COMMAND: "editor",
  EDIT_COMMAND: "editor",
  PROPOSE_CHANGE: "editor",
  REVIEW_PROPOSAL: "approver",
  APPROVE_PROPOSAL: "approver",
  REJECT_PROPOSAL: "approver",
  MANAGE_REPOS: "admin",
  MANAGE_ROLES: "admin",
  ROLLBACK_VERSION: "admin",
};

/**
 * Checks if a given role has permission to perform an action.
 * @param {string} userRole - User's assigned role.
 * @param {string} action - Action identifier from PERMISSIONS.
 * @returns {boolean} True if permitted.
 * :visibility: public
 */
export function hasPermission(userRole = "viewer", action) {
  const normalizedRole = (userRole || "viewer").toLowerCase();
  const requiredRole = PERMISSIONS[action] || "admin";
  const userLevel = ROLE_LEVELS[normalizedRole] || 1;
  const requiredLevel = ROLE_LEVELS[requiredRole] || 4;

  return userLevel >= requiredLevel;
}

/**
 * Asserts permission or throws an Authorization Error.
 * @param {string} userRole - User's role.
 * @param {string} action - Requested action.
 * @returns {boolean} True if authorized.
 * :visibility: public
 */
export function checkPermission(userRole, action) {
  if (!hasPermission(userRole, action)) {
    const req = PERMISSIONS[action] || "admin";
    throw new Error(
      `Permission denied: Action '${action}' requires '${req}' role or higher (provided: '${userRole}')`
    );
  }
  return true;
}

/**
 * Encodes command or category data into a shareable URL string.
 * @param {Object} data - Command object or category object to share.
 * @param {Object} [options] - Configuration options (scheme, secretKey, expiresInSeconds).
 * @returns {string} Formatted share URL string.
 * :visibility: public
 */
export function encodeCommandShareUrl(data, options = {}) {
  const scheme = options.scheme || "cmdbar://share";
  const secretKey = options.secretKey || "";
  const expiresInSeconds = options.expiresInSeconds || 0;

  const timestamp = Date.now();
  const expiresAt = expiresInSeconds !== 0 ? timestamp + expiresInSeconds * 1000 : 0;

  const payload = {
    version: 1,
    type: data.commands ? "category" : "command",
    data,
    timestamp,
    expiresAt,
  };

  const jsonStr = canonicalJson(payload);
  const base64Data = isNode
    ? Buffer.from(jsonStr, "utf-8").toString("base64url")
    : globalThis.btoa ? globalThis.btoa(jsonStr) : Buffer.from(jsonStr).toString("base64");

  const checksum = sha256Hex(jsonStr + secretKey);

  if (scheme.startsWith("http://") || scheme.startsWith("https://")) {
    const urlObj = new URL(scheme);
    urlObj.searchParams.set("data", base64Data);
    urlObj.searchParams.set("sig", checksum);
    return urlObj.toString();
  }

  return `${scheme}?data=${encodeURIComponent(base64Data)}&sig=${checksum}`;
}

/**
 * Decodes and validates a shared command URL.
 * @param {string} shareUrl - The share URL to decode.
 * @param {Object} [options] - Verification options (secretKey).
 * @returns {Object} Decoded result object { valid, payload, error }.
 * :visibility: public
 */
export function decodeCommandShareUrl(shareUrl, options = {}) {
  try {
    if (!shareUrl || typeof shareUrl !== "string") {
      return { valid: false, error: "Invalid or empty share URL string." };
    }

    let base64Data = "";
    let sig = "";

    if (shareUrl.includes("?")) {
      const queryString = shareUrl.split("?")[1];
      const params = new URLSearchParams(queryString);
      base64Data = params.get("data") || "";
      sig = params.get("sig") || "";
    } else {
      return { valid: false, error: "Missing query parameters in share URL." };
    }

    if (!base64Data) {
      return { valid: false, error: "Missing 'data' parameter in share URL." };
    }

    const decodedStr = isNode
      ? Buffer.from(base64Data, "base64url").toString("utf-8")
      : globalThis.atob ? globalThis.atob(decodeURIComponent(base64Data)) : Buffer.from(base64Data, "base64").toString("utf-8");

    const payload = JSON.parse(decodedStr);

    if (!payload || !payload.data) {
      return { valid: false, error: "Malformed payload structure." };
    }

    if (payload.expiresAt && payload.expiresAt !== 0 && Date.now() > payload.expiresAt) {
      return { valid: false, error: "Share URL has expired." };
    }

    const secretKey = options.secretKey || "";
    const expectedSig = sha256Hex(canonicalJson(payload) + secretKey);

    if (sig && sig !== expectedSig && options.requireSignature) {
      return { valid: false, error: "Signature verification failed." };
    }

    return {
      valid: true,
      type: payload.type,
      data: payload.data,
      timestamp: payload.timestamp,
      expiresAt: payload.expiresAt,
    };
  } catch (err) {
    return { valid: false, error: `Failed to decode share URL: ${err.message}` };
  }
}

/**
 * Imports a command or category payload from a share URL into local configuration.
 * @param {string} shareUrl - Shared command URL.
 * @param {string} [targetCategory] - Category name to place imported commands.
 * @param {Object} config - Active CmdBar configuration object.
 * @param {string} [userRole="viewer"] - Role of user performing import.
 * @returns {Object} Result object containing updated config and import summary.
 * :visibility: public
 */
export function importFromShareUrl(
  shareUrl,
  targetCategory = "Shared Commands",
  config,
  userRole = "viewer"
) {
  checkPermission(userRole, "IMPORT_URL");

  const decodeResult = decodeCommandShareUrl(shareUrl);
  if (!decodeResult.valid) {
    throw new Error(decodeResult.error);
  }

  const updatedConfig = JSON.parse(JSON.stringify(config || { categories: [] }));
  if (!Array.isArray(updatedConfig.categories)) {
    updatedConfig.categories = [];
  }

  const payloadData = decodeResult.data;
  let importedCount = 0;

  if (decodeResult.type === "category" && payloadData.commands) {
    const catName = targetCategory || payloadData.name || "Shared Commands";
    let cat = updatedConfig.categories.find((c) => c.name === catName);
    if (!cat) {
      cat = { name: catName, commands: [] };
      updatedConfig.categories.push(cat);
    }
    for (const cmd of payloadData.commands) {
      cat.commands.push(cmd);
      importedCount++;
    }
  } else {
    let cat = updatedConfig.categories.find((c) => c.name === targetCategory);
    if (!cat) {
      cat = { name: targetCategory, commands: [] };
      updatedConfig.categories.push(cat);
    }
    cat.commands.push(payloadData);
    importedCount = 1;
  }

  logActivity(updatedConfig, {
    actor: "User",
    actorRole: userRole,
    action: "IMPORT_SHARE_URL",
    target: targetCategory,
    details: `Imported ${importedCount} command(s) via URL`,
  });

  return {
    config: updatedConfig,
    importedCount,
    category: targetCategory,
  };
}

/**
 * Registers a new team repository.
 * @param {Object} repoData - Repository specifications (id, name, url, branch, role).
 * @param {Object} config - Active configuration.
 * @param {string} [userRole="admin"] - User role performing action.
 * @returns {Object} Updated configuration.
 * :visibility: public
 */
export function addTeamRepository(repoData, config, userRole = "admin") {
  checkPermission(userRole, "MANAGE_REPOS");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  if (!Array.isArray(updatedConfig.teamRepositories)) {
    updatedConfig.teamRepositories = [];
  }

  if (!repoData || !repoData.id || !repoData.name) {
    throw new Error("Repository data must include 'id' and 'name'.");
  }

  const existingIdx = updatedConfig.teamRepositories.findIndex((r) => r.id === repoData.id);
  const newRepo = {
    id: repoData.id,
    name: repoData.name,
    url: repoData.url || "",
    branch: repoData.branch || "main",
    role: repoData.role || "viewer",
    syncInterval: repoData.syncInterval || 3600,
    enabled: repoData.enabled !== false,
    autoApprove: repoData.autoApprove || false,
    lastSynced: null,
    commandsCount: 0,
  };

  if (existingIdx >= 0) {
    updatedConfig.teamRepositories[existingIdx] = {
      ...updatedConfig.teamRepositories[existingIdx],
      ...newRepo,
    };
  } else {
    updatedConfig.teamRepositories.push(newRepo);
  }

  logActivity(updatedConfig, {
    actor: "User",
    actorRole: userRole,
    action: "ADD_TEAM_REPO",
    target: repoData.name,
    details: `Registered team repository '${repoData.name}' (${repoData.url})`,
    repoId: repoData.id,
  });

  return updatedConfig;
}

/**
 * Unlinks / disconnects a team repository.
 * @param {string} repoId - Repository ID to remove.
 * @param {Object} config - Active configuration.
 * @param {string} [userRole="admin"] - User role performing removal.
 * @returns {Object} Updated configuration.
 * :visibility: public
 */
export function removeTeamRepository(repoId, config, userRole = "admin") {
  checkPermission(userRole, "MANAGE_REPOS");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  if (!Array.isArray(updatedConfig.teamRepositories)) {
    return updatedConfig;
  }

  const repo = updatedConfig.teamRepositories.find((r) => r.id === repoId);
  updatedConfig.teamRepositories = updatedConfig.teamRepositories.filter((r) => r.id !== repoId);

  // Remove category for this team repo if present
  if (repo && Array.isArray(updatedConfig.categories)) {
    const teamCatName = `Team: ${repo.name}`;
    updatedConfig.categories = updatedConfig.categories.filter((c) => c.name !== teamCatName);
  }

  logActivity(updatedConfig, {
    actor: "User",
    actorRole: userRole,
    action: "REMOVE_TEAM_REPO",
    target: repoId,
    details: `Removed team repository '${repoId}'`,
    repoId,
  });

  return updatedConfig;
}

/**
 * Returns list of all configured team repositories.
 * @param {Object} config - Active configuration.
 * @returns {Array} List of team repository objects.
 * :visibility: public
 */
export function listTeamRepositories(config) {
  return (config && config.teamRepositories) || [];
}

/**
 * Syncs commands from a team repository into the active configuration.
 * @param {string} repoId - ID of repository to sync.
 * @param {Object} config - Active configuration.
 * @param {Function} [remoteFetcher] - Optional custom async fetcher function returning commands list or json.
 * @param {string} [userRole="viewer"] - Role of user executing sync.
 * @returns {Object} Result object containing updated config and syncedCount.
 * :visibility: public
 */
export async function syncTeamRepository(
  repoId,
  config,
  remoteFetcher = null,
  userRole = "viewer"
) {
  checkPermission(userRole, "VIEW");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  const repos = listTeamRepositories(updatedConfig);
  const repo = repos.find((r) => r.id === repoId);

  if (!repo) {
    throw new Error(`Team repository with ID '${repoId}' not found.`);
  }

  let remoteData = [];
  if (typeof remoteFetcher === "function") {
    remoteData = await remoteFetcher(repo);
  } else {
    // Default mock data for local/offline sync simulation
    remoteData = [
      {
        name: `[${repo.name}] Health Check`,
        command: "curl -s http://localhost:8080/health",
        teamRepoId: repoId,
      },
      {
        name: `[${repo.name}] Deploy Status`,
        command: "git status",
        teamRepoId: repoId,
      },
    ];
  }

  const teamCatName = `Team: ${repo.name}`;
  if (!Array.isArray(updatedConfig.categories)) {
    updatedConfig.categories = [];
  }

  let cat = updatedConfig.categories.find((c) => c.name === teamCatName);
  if (!cat) {
    cat = { name: teamCatName, commands: [] };
    updatedConfig.categories.push(cat);
  } else {
    // Replace existing commands for this repo
    cat.commands = cat.commands.filter((cmd) => cmd.teamRepoId !== repoId);
  }

  const commandsList = Array.isArray(remoteData)
    ? remoteData
    : remoteData.commands || [];

  for (const cmd of commandsList) {
    cat.commands.push({
      ...cmd,
      teamRepoId: repoId,
      teamRepoName: repo.name,
    });
  }

  repo.lastSynced = new Date().toISOString();
  repo.commandsCount = cat.commands.length;

  logActivity(updatedConfig, {
    actor: "User",
    actorRole: userRole,
    action: "SYNC_TEAM_REPO",
    target: repo.name,
    details: `Synced ${cat.commands.length} command(s) from team repository '${repo.name}'`,
    repoId,
  });

  return {
    config: updatedConfig,
    syncedCount: cat.commands.length,
    repo,
  };
}

/**
 * Creates a new configuration revision snapshot for version control.
 * @param {Object} config - Active configuration.
 * @param {string} author - Author identifier/email.
 * @param {string} message - Commit/revision description.
 * @returns {Object} Updated configuration containing new revision.
 * :visibility: public
 */
export function createConfigRevision(config, author = "system", message = "Updated configuration") {
  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  if (!updatedConfig.versionControl) {
    updatedConfig.versionControl = { currentRevision: 0, revisions: [] };
  }

  const revNum = updatedConfig.versionControl.currentRevision + 1;
  const timestamp = new Date().toISOString();

  // Snapshot categories & commands
  const categoriesSnapshot = JSON.parse(JSON.stringify(updatedConfig.categories || []));
  const commitHash = sha256Hex(canonicalJson(categoriesSnapshot) + timestamp + author);

  const prevRev = updatedConfig.versionControl.revisions.length > 0
    ? updatedConfig.versionControl.revisions[updatedConfig.versionControl.revisions.length - 1]
    : null;

  const diffSummary = prevRev
    ? diffConfigRevisions(prevRev.categories, categoriesSnapshot)
    : { addedCommands: categoriesSnapshot.flatMap((c) => c.commands || []).length, removedCommands: 0, modifiedCommands: 0 };

  const newRevision = {
    revision: revNum,
    commitHash,
    timestamp,
    author,
    message,
    diffSummary,
    categories: categoriesSnapshot,
  };

  updatedConfig.versionControl.currentRevision = revNum;
  updatedConfig.versionControl.revisions.push(newRevision);

  logActivity(updatedConfig, {
    actor: author,
    actorRole: "user",
    action: "CREATE_REVISION",
    target: `Rev #${revNum}`,
    details: `Created revision #${revNum}: ${message}`,
  });

  return updatedConfig;
}

/**
 * Retrieves full history of configuration revisions.
 * @param {Object} config - Active configuration.
 * @returns {Array} List of revision objects.
 * :visibility: public
 */
export function getRevisionHistory(config) {
  return (config && config.versionControl && config.versionControl.revisions) || [];
}

/**
 * Compares two category/command snapshots and produces a diff summary.
 * @param {Array} snapshotA - Original categories list.
 * @param {Array} snapshotB - Target categories list.
 * @returns {Object} Diff summary object { addedCommands, removedCommands, modifiedCommands }.
 * :visibility: public
 */
export function diffConfigRevisions(snapshotA = [], snapshotB = []) {
  const mapA = new Map();
  const mapB = new Map();

  for (const cat of snapshotA) {
    for (const cmd of cat.commands || []) {
      mapA.set(`${cat.name}::${cmd.name}`, cmd);
    }
  }

  for (const cat of snapshotB) {
    for (const cmd of cat.commands || []) {
      mapB.set(`${cat.name}::${cmd.name}`, cmd);
    }
  }

  let addedCommands = 0;
  let removedCommands = 0;
  let modifiedCommands = 0;

  for (const [key, cmdB] of mapB.entries()) {
    if (!mapA.has(key)) {
      addedCommands++;
    } else {
      const cmdA = mapA.get(key);
      if (cmdA.command !== cmdB.command || canonicalJson(cmdA) !== canonicalJson(cmdB)) {
        modifiedCommands++;
      }
    }
  }

  for (const key of mapA.keys()) {
    if (!mapB.has(key)) {
      removedCommands++;
    }
  }

  return { addedCommands, removedCommands, modifiedCommands };
}

/**
 * Restores configuration to a previous revision.
 * @param {Object} config - Active configuration.
 * @param {number} revisionId - Revision number to roll back to.
 * @param {string} [userRole="admin"] - User role executing rollback.
 * @returns {Object} Updated configuration restored to specified revision.
 * :visibility: public
 */
export function rollbackToRevision(config, revisionId, userRole = "admin") {
  checkPermission(userRole, "ROLLBACK_VERSION");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  const history = getRevisionHistory(updatedConfig);
  const targetRev = history.find((r) => r.revision === Number(revisionId));

  if (!targetRev) {
    throw new Error(`Revision #${revisionId} not found in history.`);
  }

  updatedConfig.categories = JSON.parse(JSON.stringify(targetRev.categories));

  return createConfigRevision(
    updatedConfig,
    "admin",
    `Rollback to revision #${revisionId} (${targetRev.commitHash.substring(0, 7)})`
  );
}

/**
 * Creates a pending proposal for a command change in a team repository.
 * @param {Object} config - Active configuration.
 * @param {Object} params - { repoId, commandData, author, description }.
 * @param {string} [userRole="editor"] - User role submitting proposal.
 * @returns {Object} Updated configuration.
 * :visibility: public
 */
export function createProposal(
  config,
  { repoId, commandData, author = "editor", description = "" },
  userRole = "editor"
) {
  checkPermission(userRole, "PROPOSE_CHANGE");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  if (!updatedConfig.approvalWorkflows) {
    updatedConfig.approvalWorkflows = { proposals: [] };
  }
  if (!Array.isArray(updatedConfig.approvalWorkflows.proposals)) {
    updatedConfig.approvalWorkflows.proposals = [];
  }

  const proposalId = `prop-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const proposal = {
    id: proposalId,
    repoId,
    commandData,
    author,
    description,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviews: [],
  };

  updatedConfig.approvalWorkflows.proposals.push(proposal);

  logActivity(updatedConfig, {
    actor: author,
    actorRole: userRole,
    action: "CREATE_PROPOSAL",
    target: commandData.name || "Command Proposal",
    details: `Submitted proposal '${proposalId}': ${description}`,
    repoId,
  });

  return { config: updatedConfig, proposal };
}

/**
 * Reviews (approves or rejects) a pending proposal.
 * @param {Object} config - Active configuration.
 * @param {string} proposalId - Proposal ID.
 * @param {Object} reviewData - { status, reviewer, comment }.
 * @param {string} [reviewerRole="approver"] - Reviewer's role.
 * @returns {Object} Result object with updated config and proposal.
 * :visibility: public
 */
export function reviewProposal(
  config,
  proposalId,
  { status, reviewer = "approver", comment = "" },
  reviewerRole = "approver"
) {
  checkPermission(reviewerRole, "REVIEW_PROPOSAL");

  if (status !== "approved" && status !== "rejected") {
    throw new Error("Review status must be either 'approved' or 'rejected'.");
  }

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  const proposals = (updatedConfig.approvalWorkflows && updatedConfig.approvalWorkflows.proposals) || [];
  const proposal = proposals.find((p) => p.id === proposalId);

  if (!proposal) {
    throw new Error(`Proposal '${proposalId}' not found.`);
  }

  proposal.status = status;
  proposal.updatedAt = new Date().toISOString();
  proposal.reviews.push({
    reviewer,
    role: reviewerRole,
    status,
    comment,
    timestamp: new Date().toISOString(),
  });

  logActivity(updatedConfig, {
    actor: reviewer,
    actorRole: reviewerRole,
    action: status === "approved" ? "APPROVE_PROPOSAL" : "REJECT_PROPOSAL",
    target: proposalId,
    details: `${status.toUpperCase()} proposal '${proposalId}': ${comment}`,
    repoId: proposal.repoId,
  });

  return { config: updatedConfig, proposal };
}

/**
 * Merges an approved proposal into active team commands.
 * @param {Object} config - Active configuration.
 * @param {string} proposalId - Proposal ID.
 * @param {string} [userRole="approver"] - User role executing merge.
 * @returns {Object} Updated configuration.
 * :visibility: public
 */
export function mergeProposal(config, proposalId, userRole = "approver") {
  checkPermission(userRole, "APPROVE_PROPOSAL");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  const proposals = (updatedConfig.approvalWorkflows && updatedConfig.approvalWorkflows.proposals) || [];
  const proposal = proposals.find((p) => p.id === proposalId);

  if (!proposal) {
    throw new Error(`Proposal '${proposalId}' not found.`);
  }

  if (proposal.status !== "approved") {
    throw new Error(`Proposal '${proposalId}' must be approved before merging (current status: '${proposal.status}').`);
  }

  const repo = listTeamRepositories(updatedConfig).find((r) => r.id === proposal.repoId);
  const teamCatName = repo ? `Team: ${repo.name}` : "Team Shared Commands";

  if (!Array.isArray(updatedConfig.categories)) {
    updatedConfig.categories = [];
  }

  let cat = updatedConfig.categories.find((c) => c.name === teamCatName);
  if (!cat) {
    cat = { name: teamCatName, commands: [] };
    updatedConfig.categories.push(cat);
  }

  cat.commands.push({
    ...proposal.commandData,
    teamRepoId: proposal.repoId,
  });

  proposal.status = "merged";
  proposal.updatedAt = new Date().toISOString();

  logActivity(updatedConfig, {
    actor: "System",
    actorRole: userRole,
    action: "MERGE_PROPOSAL",
    target: proposalId,
    details: `Merged proposal '${proposalId}' into category '${teamCatName}'`,
    repoId: proposal.repoId,
  });

  return createConfigRevision(
    updatedConfig,
    proposal.author,
    `Merged team proposal: ${proposal.commandData.name || proposalId}`
  );
}

/**
 * Returns list of proposals filtered by status, repo, or author.
 * @param {Object} config - Active configuration.
 * @param {Object} [filters] - Filter parameters { status, repoId, author }.
 * @returns {Array} List of matching proposals.
 * :visibility: public
 */
export function listProposals(config, filters = {}) {
  const proposals = (config && config.approvalWorkflows && config.approvalWorkflows.proposals) || [];
  return proposals.filter((p) => {
    if (filters.status && p.status !== filters.status) return false;
    if (filters.repoId && p.repoId !== filters.repoId) return false;
    if (filters.author && p.author !== filters.author) return false;
    return true;
  });
}

/**
 * Appends an event entry to the activity log.
 * @param {Object} config - Active configuration.
 * @param {Object} eventData - { actor, actorRole, action, target, details, repoId }.
 * @returns {Object} Created activity entry.
 * :visibility: public
 */
export function logActivity(config, { actor = "system", actorRole = "viewer", action, target, details = "", repoId = null }) {
  if (!config) return null;
  if (!Array.isArray(config.activityFeed)) {
    config.activityFeed = [];
  }

  const entry = {
    id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    actor,
    actorRole,
    action,
    target,
    details,
    repoId,
  };

  config.activityFeed.unshift(entry);

  // Keep max 1000 items
  if (config.activityFeed.length > 1000) {
    config.activityFeed.length = 1000;
  }

  return entry;
}

/**
 * Returns filtered and paginated activity feed log entries.
 * @param {Object} config - Active configuration.
 * @param {Object} [filters] - Filter parameters { repoId, actor, action, limit, offset }.
 * @returns {Object} Result object { items, total }.
 * :visibility: public
 */
export function getActivityFeed(config, filters = {}) {
  const feed = (config && config.activityFeed) || [];
  const filtered = feed.filter((entry) => {
    if (filters.repoId && entry.repoId !== filters.repoId) return false;
    if (filters.actor && entry.actor !== filters.actor) return false;
    if (filters.action && entry.action !== filters.action) return false;
    return true;
  });

  const offset = Number(filters.offset) || 0;
  const limit = Number(filters.limit) || 100;
  const items = filtered.slice(offset, offset + limit);

  return { items, total: filtered.length };
}

/**
 * Clears activity log entries.
 * @param {Object} config - Active configuration.
 * @param {string} [userRole="admin"] - User role executing clear.
 * @returns {Object} Updated configuration.
 * :visibility: public
 */
export function clearActivityFeed(config, userRole = "admin") {
  checkPermission(userRole, "MANAGE_REPOS");

  const updatedConfig = JSON.parse(JSON.stringify(config || {}));
  updatedConfig.activityFeed = [];
  return updatedConfig;
}
