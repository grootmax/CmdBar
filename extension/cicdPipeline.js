/**
 * CmdBar CI/CD Integration Pipeline Module
 * Provides unified status monitoring, deployment triggering, rollback execution,
 * and secret masking across GitHub Actions, GitLab CI, and Jenkins.
 *
 * @module cicdPipeline
 */

/**
 * Default provider configurations and environment variable key mappings.
 */
const PROVIDER_ENV_MAP = {
  github: {
    tokenEnv: "GITHUB_TOKEN",
    repoEnv: "GITHUB_REPOSITORY",
    baseUrl: "https://api.github.com",
  },
  gitlab: {
    tokenEnv: "GITLAB_TOKEN",
    projectEnv: "GITLAB_PROJECT_ID",
    baseUrl: "https://gitlab.com/api/v4",
  },
  jenkins: {
    tokenEnv: "JENKINS_API_TOKEN",
    userEnv: "JENKINS_USER",
    urlEnv: "JENKINS_URL",
    baseUrl: "http://localhost:8080",
  },
};

/**
 * Normalizes CI/CD configuration options by combining explicitly provided parameters
 * with environment variable defaults and ensuring required endpoints are present.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', or 'jenkins').
 * @param {Object} [options={}] - Custom configuration parameters.
 * @returns {Object} Normalized provider configuration.
 */
export function normalizeConfig(provider, options = {}) {
  const normProvider = (provider || "github").toLowerCase().trim();
  const mapping = PROVIDER_ENV_MAP[normProvider] || PROVIDER_ENV_MAP.github;

  const env = (typeof process !== "undefined" && process.env) || {};

  const token = options.token || env[mapping.tokenEnv] || "";
  const baseUrl = (options.baseUrl || options.url || env[mapping.urlEnv] || mapping.baseUrl).replace(/\/+$/, "");
  const repo = options.repo || options.repository || env[mapping.repoEnv] || "";
  const projectId = options.projectId || options.project || env[mapping.projectEnv] || repo;
  const job = options.job || options.jobName || options.workflow || "";
  const branch = options.branch || options.ref || "main";
  const user = options.user || options.username || env[mapping.userEnv] || "";

  return {
    provider: normProvider,
    token,
    baseUrl,
    repo,
    projectId,
    job,
    branch,
    user,
    extraHeaders: options.extraHeaders || {},
  };
}

/**
 * Masks sensitive tokens and secret values in output strings, URLs, or log messages.
 *
 * @public
 * @param {string} text - Raw text string that may contain sensitive data.
 * @param {string[]} [additionalSecrets=[]] - Additional secret strings to mask.
 * @returns {string} Text with all detected or provided secrets replaced with '[REDACTED]'.
 */
export function maskSecrets(text, additionalSecrets = []) {
  if (text === null || text === undefined) return "";
  let result = String(text);

  // Common pattern matches for API tokens, bearer headers, and credentials
  const patterns = [
    /ghp_[a-zA-Z0-9]{20,}/g,
    /glpat-[a-zA-Z0-9_-]{15,}/g,
    /Bearer\s+[a-zA-Z0-9._-]+/gi,
    /token\s+[a-zA-Z0-9._-]+/gi,
    /Basic\s+[a-zA-Z0-9+/=]+/gi,
  ];

  patterns.forEach((pattern) => {
    result = result.replace(pattern, "[REDACTED]");
  });

  // URL basic auth
  result = result.replace(/https?:\/\/([^:]+):([^@]+)@/g, (match, user, pass) => {
    return match.replace(`:${pass}@`, ":[REDACTED]@");
  });

  // Explicit secrets array
  const secrets = Array.isArray(additionalSecrets) ? additionalSecrets : [additionalSecrets];
  secrets.forEach((secret) => {
    if (secret && typeof secret === "string" && secret.trim().length > 2) {
      const cleanSecret = secret.trim();
      result = result.split(cleanSecret).join("[REDACTED]");
    }
  });

  // Also check standard environment variable secrets
  if (typeof process !== "undefined" && process.env) {
    const envKeys = ["GITHUB_TOKEN", "GITLAB_TOKEN", "JENKINS_API_TOKEN", "AWS_SECRET_ACCESS_KEY"];
    envKeys.forEach((key) => {
      const val = process.env[key];
      if (val && val.trim().length > 2) {
        result = result.split(val.trim()).join("[REDACTED]");
      }
    });
  }

  return result;
}

/**
 * Standardizes raw API pipeline status responses from GitHub Actions, GitLab CI, or Jenkins.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} rawData - Raw JSON response object from provider API.
 * @returns {Object} Standardized pipeline status object.
 */
export function parsePipelineStatus(provider, rawData) {
  const normProvider = (provider || "github").toLowerCase().trim();
  const raw = rawData || {};

  let id = "N/A";
  let status = "unknown";
  let outcome = "unknown";
  let branch = "unknown";
  let commit = "unknown";
  let author = "unknown";
  let url = "";
  let duration = "0s";
  let timestamp = new Date().toISOString();
  let stages = [];

  if (normProvider === "github") {
    const run = raw.workflow_runs ? raw.workflow_runs[0] || {} : raw;
    id = String(run.id || "N/A");
    branch = run.head_branch || "main";
    commit = run.head_sha ? run.head_sha.substring(0, 7) : "unknown";
    author = (run.head_commit && run.head_commit.author && run.head_commit.author.name) ||
             (run.actor && run.actor.login) || "unknown";
    url = run.html_url || "";
    timestamp = run.updated_at || run.created_at || timestamp;

    const rawStatus = (run.status || "").toLowerCase();
    const rawConclusion = (run.conclusion || "").toLowerCase();

    if (rawStatus === "completed") {
      if (rawConclusion === "success") {
        status = "success";
        outcome = "success";
      } else if (["failure", "timed_out", "action_required"].includes(rawConclusion)) {
        status = "failed";
        outcome = rawConclusion;
      } else if (["cancelled", "skipped"].includes(rawConclusion)) {
        status = "cancelled";
        outcome = rawConclusion;
      } else {
        status = rawConclusion || "completed";
        outcome = rawConclusion;
      }
    } else if (["in_progress", "queued", "requested", "waiting"].includes(rawStatus)) {
      status = rawStatus === "in_progress" ? "running" : "queued";
      outcome = "pending";
    }

    if (run.created_at && run.updated_at) {
      const ms = new Date(run.updated_at) - new Date(run.created_at);
      if (!isNaN(ms) && ms >= 0) {
        duration = `${Math.round(ms / 1000)}s`;
      }
    }

    if (Array.isArray(raw.jobs)) {
      stages = raw.jobs.map((j) => ({
        name: j.name,
        status: j.conclusion || j.status || "unknown",
      }));
    }
  } else if (normProvider === "gitlab") {
    const pipe = Array.isArray(raw) ? raw[0] || {} : raw;
    id = String(pipe.id || "N/A");
    branch = pipe.ref || "main";
    commit = pipe.sha ? pipe.sha.substring(0, 7) : "unknown";
    author = (pipe.user && pipe.user.name) || "unknown";
    url = pipe.web_url || "";
    timestamp = pipe.updated_at || pipe.created_at || timestamp;

    const rawStatus = (pipe.status || "").toLowerCase();
    if (["success", "passed"].includes(rawStatus)) {
      status = "success";
      outcome = "success";
    } else if (["failed"].includes(rawStatus)) {
      status = "failed";
      outcome = "failed";
    } else if (["canceled", "skipped"].includes(rawStatus)) {
      status = "cancelled";
      outcome = rawStatus;
    } else if (["running", "pending", "created", "waiting_for_resource", "manual"].includes(rawStatus)) {
      status = rawStatus === "running" ? "running" : "queued";
      outcome = "pending";
    }

    if (pipe.duration) {
      duration = `${pipe.duration}s`;
    }

    if (Array.isArray(pipe.details && pipe.details.stages)) {
      stages = pipe.details.stages.map((s) => ({
        name: s.name,
        status: s.status || "unknown",
      }));
    }
  } else if (normProvider === "jenkins") {
    id = String(raw.number || raw.id || "N/A");
    branch = "main";
    url = raw.url || "";
    timestamp = raw.timestamp ? new Date(raw.timestamp).toISOString() : timestamp;

    if (raw.actions) {
      for (const act of raw.actions) {
        if (act.lastBuiltRevision && act.lastBuiltRevision.SHA1) {
          commit = act.lastBuiltRevision.SHA1.substring(0, 7);
        }
        if (act.lastBuiltRevision && act.lastBuiltRevision.branch && act.lastBuiltRevision.branch[0]) {
          branch = act.lastBuiltRevision.branch[0].name || branch;
        }
        if (act.causes && act.causes[0] && act.causes[0].userName) {
          author = act.causes[0].userName;
        }
      }
    }

    if (raw.building) {
      status = "running";
      outcome = "pending";
    } else {
      const result = (raw.result || "").toUpperCase();
      if (result === "SUCCESS") {
        status = "success";
        outcome = "success";
      } else if (["FAILURE", "UNSTABLE"].includes(result)) {
        status = "failed";
        outcome = result.toLowerCase();
      } else if (result === "ABORTED") {
        status = "cancelled";
        outcome = "aborted";
      }
    }

    if (raw.duration) {
      duration = `${Math.round(raw.duration / 1000)}s`;
    }

    if (Array.isArray(raw.stages)) {
      stages = raw.stages.map((st) => ({
        name: st.name,
        status: (st.status || "unknown").toLowerCase(),
      }));
    }
  }

  return {
    provider: normProvider,
    id,
    status,
    outcome,
    branch,
    commit,
    author,
    url,
    duration,
    timestamp,
    stages,
  };
}

/**
 * Formats a standardized pipeline status object into a user-friendly string output.
 *
 * @public
 * @param {Object} statusObj - Standardized pipeline status object.
 * @returns {string} Formatted text display for CmdBar notifications or UI view.
 */
export function formatPipelineStatusOutput(statusObj) {
  if (!statusObj) return "No pipeline status available.";

  const iconMap = {
    success: "✅ SUCCESS",
    failed: "❌ FAILED",
    running: "🔄 RUNNING",
    queued: "⏳ QUEUED",
    cancelled: "🚫 CANCELLED",
    unknown: "❓ UNKNOWN",
  };

  const statusTag = iconMap[statusObj.status] || `[${(statusObj.status || "UNKNOWN").toUpperCase()}]`;
  const providerTag = (statusObj.provider || "ci").toUpperCase();

  let output = `[${providerTag}] Pipeline #${statusObj.id}: ${statusTag}\n`;
  output += `• Branch: ${statusObj.branch} (${statusObj.commit})\n`;
  output += `• Author: ${statusObj.author}\n`;
  output += `• Duration: ${statusObj.duration}\n`;

  if (statusObj.stages && statusObj.stages.length > 0) {
    output += `• Stages:\n`;
    statusObj.stages.forEach((st) => {
      const stTag = st.status === "success" || st.status === "SUCCESS" ? "✓" : st.status === "failed" ? "✗" : "•";
      output += `   ${stTag} ${st.name}: ${st.status}\n`;
    });
  }

  if (statusObj.url) {
    output += `• URL: ${maskSecrets(statusObj.url)}`;
  }

  return output.trim();
}

/**
 * Generates an executable shell command string (e.g. curl, gh, glab) to trigger a deployment.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} [options={}] - Deployment options (repo, ref, env, inputs/vars).
 * @returns {string} Executable shell command string.
 */
export function getTriggerCommand(provider, options = {}) {
  const cfg = normalizeConfig(provider, options);
  const ref = cfg.branch;
  const env = options.environment || "production";
  const inputs = options.inputs || {};

  if (cfg.provider === "github") {
    const payload = JSON.stringify({
      ref,
      inputs: { environment: env, ...inputs },
    });
    const workflow = cfg.job || "deploy.yml";
    return maskSecrets(
      `curl -s -X POST -H "Authorization: Bearer ${cfg.token || "$GITHUB_TOKEN"}" ` +
      `-H "Accept: application/vnd.github.v3+json" ` +
      `"${cfg.baseUrl}/repos/${cfg.repo}/actions/workflows/${workflow}/dispatches" ` +
      `-d '${payload}'`,
      [cfg.token]
    );
  } else if (cfg.provider === "gitlab") {
    const payload = JSON.stringify({
      ref,
      variables: [
        { key: "ENVIRONMENT", value: env },
        ...Object.entries(inputs).map(([k, v]) => ({ key: k, value: String(v) })),
      ],
    });
    return maskSecrets(
      `curl -s -X POST -H "PRIVATE-TOKEN: ${cfg.token || "$GITLAB_TOKEN"}" ` +
      `-H "Content-Type: application/json" ` +
      `"${cfg.baseUrl}/projects/${encodeURIComponent(cfg.projectId)}/pipeline" ` +
      `-d '${payload}'`,
      [cfg.token]
    );
  } else if (cfg.provider === "jenkins") {
    const job = cfg.job || "build-job";
    const authHeader = cfg.user && cfg.token ? `-u "${cfg.user}:${cfg.token}" ` : "";
    const paramStr = Object.entries({ ENVIRONMENT: env, ...inputs })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const endpoint = paramStr ? `buildWithParameters?${paramStr}` : "build";

    return maskSecrets(
      `curl -s -X POST ${authHeader}` +
      `"${cfg.baseUrl}/job/${encodeURIComponent(job)}/${endpoint}"`,
      [cfg.token]
    );
  }

  return "echo 'Unsupported provider for trigger command'";
}

/**
 * Generates an executable shell command string to query pipeline status.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} [options={}] - Pipeline query options.
 * @returns {string} Executable shell command string.
 */
export function getStatusCommand(provider, options = {}) {
  const cfg = normalizeConfig(provider, options);

  if (cfg.provider === "github") {
    return maskSecrets(
      `curl -s -H "Authorization: Bearer ${cfg.token || "$GITHUB_TOKEN"}" ` +
      `-H "Accept: application/vnd.github.v3+json" ` +
      `"${cfg.baseUrl}/repos/${cfg.repo}/actions/runs?per_page=1"`,
      [cfg.token]
    );
  } else if (cfg.provider === "gitlab") {
    return maskSecrets(
      `curl -s -H "PRIVATE-TOKEN: ${cfg.token || "$GITLAB_TOKEN"}" ` +
      `"${cfg.baseUrl}/projects/${encodeURIComponent(cfg.projectId)}/pipelines?per_page=1"`,
      [cfg.token]
    );
  } else if (cfg.provider === "jenkins") {
    const job = cfg.job || "build-job";
    const authHeader = cfg.user && cfg.token ? `-u "${cfg.user}:${cfg.token}" ` : "";
    return maskSecrets(
      `curl -s ${authHeader}` +
      `"${cfg.baseUrl}/job/${encodeURIComponent(job)}/lastBuild/api/json"`,
      [cfg.token]
    );
  }

  return "echo 'Unsupported provider for status command'";
}

/**
 * Generates an executable shell command string to trigger a rollback.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} [options={}] - Rollback options (targetVersion, targetCommit, etc.).
 * @returns {string} Executable shell command string.
 */
export function getRollbackCommand(provider, options = {}) {
  const targetVersion = options.targetVersion || options.targetCommit || options.version || "previous";
  const rollbackOptions = {
    ...options,
    inputs: {
      ACTION: "rollback",
      TARGET_VERSION: targetVersion,
      ...(options.inputs || {}),
    },
  };

  return getTriggerCommand(provider, rollbackOptions);
}

/**
 * Helper HTTP fetch function supporting mock handlers for unit testing and offline verification.
 */
async function _executeFetch(url, init, options = {}) {
  if (typeof options.mockFetch === "function") {
    return await options.mockFetch(url, init);
  }

  if (options.mockResponse) {
    return {
      ok: options.mockResponse.ok !== false,
      status: options.mockResponse.status || 200,
      json: async () => options.mockResponse.data || options.mockResponse,
      text: async () => JSON.stringify(options.mockResponse.data || options.mockResponse),
    };
  }

  if (typeof fetch !== "undefined") {
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    return { ok: res.ok, status: res.status, json: async () => data, data };
  }

  throw new Error("HTTP fetch environment unavailable and no mock provided.");
}

/**
 * Asynchronously queries the pipeline status for a given provider.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} [options={}] - Query options and credentials.
 * @returns {Promise<Object>} Standardized pipeline status object.
 */
export async function getPipelineStatus(provider, options = {}) {
  const cfg = normalizeConfig(provider, options);

  try {
    let url = "";
    let headers = { ...cfg.extraHeaders };

    if (cfg.provider === "github") {
      url = `${cfg.baseUrl}/repos/${cfg.repo}/actions/runs?per_page=1`;
      if (cfg.token) {
        headers["Authorization"] = `Bearer ${cfg.token}`;
      }
      headers["Accept"] = "application/vnd.github.v3+json";
    } else if (cfg.provider === "gitlab") {
      url = `${cfg.baseUrl}/projects/${encodeURIComponent(cfg.projectId)}/pipelines?per_page=1`;
      if (cfg.token) {
        headers["PRIVATE-TOKEN"] = cfg.token;
      }
    } else if (cfg.provider === "jenkins") {
      const job = cfg.job || "build-job";
      url = `${cfg.baseUrl}/job/${encodeURIComponent(job)}/lastBuild/api/json`;
      if (cfg.user && cfg.token) {
        const auth = typeof Buffer !== "undefined"
          ? Buffer.from(`${cfg.user}:${cfg.token}`).toString("base64")
          : btoa(`${cfg.user}:${cfg.token}`);
        headers["Authorization"] = `Basic ${auth}`;
      }
    }

    const res = await _executeFetch(url, { method: "GET", headers }, options);
    const data = res.data || (await res.json());

    return parsePipelineStatus(cfg.provider, data);
  } catch (err) {
    return {
      provider: cfg.provider,
      id: "N/A",
      status: "failed",
      outcome: "error",
      branch: cfg.branch,
      commit: "unknown",
      author: "unknown",
      url: "",
      duration: "0s",
      timestamp: new Date().toISOString(),
      stages: [],
      error: maskSecrets(err.message, [cfg.token]),
    };
  }
}

/**
 * Asynchronously triggers a deployment for a given provider.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} [options={}] - Deployment parameters and credentials.
 * @returns {Promise<Object>} Trigger result object.
 */
export async function triggerDeployment(provider, options = {}) {
  const cfg = normalizeConfig(provider, options);

  try {
    let url = "";
    let headers = { "Content-Type": "application/json", ...cfg.extraHeaders };
    let body = null;

    if (cfg.provider === "github") {
      const workflow = cfg.job || "deploy.yml";
      url = `${cfg.baseUrl}/repos/${cfg.repo}/actions/workflows/${workflow}/dispatches`;
      if (cfg.token) {
        headers["Authorization"] = `Bearer ${cfg.token}`;
      }
      headers["Accept"] = "application/vnd.github.v3+json";
      body = JSON.stringify({
        ref: cfg.branch,
        inputs: options.inputs || { environment: options.environment || "production" },
      });
    } else if (cfg.provider === "gitlab") {
      url = `${cfg.baseUrl}/projects/${encodeURIComponent(cfg.projectId)}/pipeline`;
      if (cfg.token) {
        headers["PRIVATE-TOKEN"] = cfg.token;
      }
      body = JSON.stringify({
        ref: cfg.branch,
        variables: [
          { key: "ENVIRONMENT", value: options.environment || "production" },
          ...Object.entries(options.inputs || {}).map(([k, v]) => ({ key: k, value: String(v) })),
        ],
      });
    } else if (cfg.provider === "jenkins") {
      const job = cfg.job || "build-job";
      url = `${cfg.baseUrl}/job/${encodeURIComponent(job)}/build`;
      if (cfg.user && cfg.token) {
        const auth = typeof Buffer !== "undefined"
          ? Buffer.from(`${cfg.user}:${cfg.token}`).toString("base64")
          : btoa(`${cfg.user}:${cfg.token}`);
        headers["Authorization"] = `Basic ${auth}`;
      }
      body = JSON.stringify(options.inputs || {});
    }

    const res = await _executeFetch(url, { method: "POST", headers, body }, options);
    const data = res.data || (await res.json().catch(() => ({})));

    return {
      success: true,
      provider: cfg.provider,
      buildId: data.id || data.number || "triggered",
      status: "queued",
      message: `Deployment triggered successfully on ${cfg.provider}.`,
      url: maskSecrets(data.web_url || data.html_url || url, [cfg.token]),
    };
  } catch (err) {
    return {
      success: false,
      provider: cfg.provider,
      buildId: null,
      status: "failed",
      message: `Failed to trigger deployment on ${cfg.provider}: ${maskSecrets(err.message, [cfg.token])}`,
    };
  }
}

/**
 * Asynchronously executes a rollback deployment for a given provider.
 *
 * @public
 * @param {string} provider - Provider name ('github', 'gitlab', 'jenkins').
 * @param {Object} [options={}] - Rollback parameters and credentials.
 * @returns {Promise<Object>} Rollback result object.
 */
export async function executeRollback(provider, options = {}) {
  const targetVersion = options.targetVersion || options.targetCommit || options.version || "previous";
  const rollbackInputs = {
    ACTION: "rollback",
    TARGET_VERSION: targetVersion,
    ...(options.inputs || {}),
  };

  const triggerRes = await triggerDeployment(provider, {
    ...options,
    inputs: rollbackInputs,
  });

  if (triggerRes.success) {
    return {
      success: true,
      provider: triggerRes.provider,
      rollbackVersion: targetVersion,
      buildId: triggerRes.buildId,
      status: "queued",
      message: `Rollback to ${targetVersion} initiated successfully on ${triggerRes.provider}.`,
      url: triggerRes.url,
    };
  } else {
    return {
      success: false,
      provider: triggerRes.provider,
      rollbackVersion: targetVersion,
      buildId: null,
      status: "failed",
      message: `Rollback failed: ${triggerRes.message}`,
    };
  }
}
