/**
 * CI/CD Integration Pipeline Module for CmdBar.
 * Provides integration with GitHub Actions, GitLab CI, and Jenkins.
 * Enables triggering deployments/pipelines, monitoring status, executing rollbacks,
 * and managing secrets securely.
 */

const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

/**
 * Normalizes provider name strings to canonical forms ('github', 'gitlab', 'jenkins').
 * @param {string} provider
 * @returns {string}
 * @public
 */
export function normalizeProvider(provider) {
  if (!provider || typeof provider !== "string") {
    return "unknown";
  }
  const clean = provider.trim().toLowerCase();
  if (clean.includes("github")) return "github";
  if (clean.includes("gitlab")) return "gitlab";
  if (clean.includes("jenkins")) return "jenkins";
  return clean;
}

/**
 * Resolves authentication credentials and base URLs for CI/CD providers.
 * Checks configuration objects and environment variables securely.
 * @param {string} provider
 * @param {object} [config={}]
 * @param {object} [env=process.env]
 * @returns {{ token: string, user: string, baseUrl: string }}
 * @public
 */
export function resolveSecrets(provider, config = {}, env = typeof process !== "undefined" && process.env ? process.env : {}) {
  const norm = normalizeProvider(provider);
  const cicdCfg = (config && config.cicd && config.cicd[norm]) || {};
  const secretsCfg = (config && config.secrets) || {};

  let token = cicdCfg.token || secretsCfg[`${norm}_token`] || (secretsCfg[norm] && secretsCfg[norm].token) || "";
  let user = cicdCfg.user || secretsCfg[`${norm}_user`] || "";
  let baseUrl = cicdCfg.baseUrl || cicdCfg.url || "";

  if (norm === "github") {
    if (!token) {
      token = env.GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_PAT || "";
    }
    if (!baseUrl) {
      baseUrl = env.GITHUB_API_URL || "https://api.github.com";
    }
  } else if (norm === "gitlab") {
    if (!token) {
      token = env.GITLAB_TOKEN || env.GL_TOKEN || env.GITLAB_PRIVATE_TOKEN || "";
    }
    if (!baseUrl) {
      baseUrl = env.GITLAB_API_URL || "https://gitlab.com";
    }
  } else if (norm === "jenkins") {
    if (!token) {
      token = env.JENKINS_TOKEN || env.JENKINS_API_TOKEN || env.JENKINS_SECRET || env.JENKINS_PASSWORD || "";
    }
    if (!user) {
      user = env.JENKINS_USER || env.JENKINS_USERNAME || "";
    }
    if (!baseUrl) {
      baseUrl = env.JENKINS_URL || "http://localhost:8080";
    }
  }

  baseUrl = baseUrl.replace(/\/+$/, "");

  return {
    token: String(token).trim(),
    user: String(user).trim(),
    baseUrl: baseUrl.trim(),
  };
}

const SENSITIVE_KEY_REGEX = /token|secret|password|auth|authorization|api_key|apikey|private_key|access_token/i;

/**
 * Redacts sensitive tokens, API keys, passwords, and authorization headers from strings or objects.
 * @param {string|object|Array} input
 * @param {string[]} [customSecrets=[]]
 * @returns {string|object|Array}
 * @public
 */
export function redactSecrets(input, customSecrets = []) {
  if (input === null || input === undefined) {
    return input;
  }

  const secretsSet = new Set();
  if (Array.isArray(customSecrets)) {
    for (const s of customSecrets) {
      if (s && typeof s === "string" && s.trim().length >= 3) {
        secretsSet.add(s.trim());
      }
    }
  }

  const sanitizeString = (str) => {
    let result = String(str);
    for (const secret of secretsSet) {
      if (secret && result.includes(secret)) {
        const escaped = secret.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        result = result.replace(new RegExp(escaped, "g"), "[REDACTED]");
      }
    }
    result = result.replace(/(Bearer\s+)[A-Za-z0-9_.~+-]+/gi, "$1[REDACTED]");
    result = result.replace(/(PRIVATE-TOKEN:\s*)[A-Za-z0-9_.~+-]+/gi, "$1[REDACTED]");
    result = result.replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, "$1[REDACTED]");
    result = result.replace(/(token=)[A-Za-z0-9_.~+-]+/gi, "$1[REDACTED]");
    result = result.replace(/(password=)[^&\s]+/gi, "$1[REDACTED]");
    return result;
  };

  if (typeof input === "string") {
    return sanitizeString(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, customSecrets));
  }

  if (typeof input === "object") {
    const redactedObj = {};
    for (const [key, value] of Object.entries(input)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        redactedObj[key] = "[REDACTED]";
      } else {
        redactedObj[key] = redactSecrets(value, customSecrets);
      }
    }
    return redactedObj;
  }

  return input;
}

/**
 * Default fetch transport implementation.
 * @param {string} url
 * @param {object} [options={}]
 * @returns {Promise<object>} Response wrapper
 */
async function defaultFetchTransport(url, options = {}) {
  if (typeof globalThis.fetch === "function") {
    const res = await globalThis.fetch(url, options);
    const textData = await res.text();
    let jsonData = null;
    try {
      jsonData = JSON.parse(textData);
    } catch (e) {}
    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: res.headers,
      json: async () => (jsonData !== null ? jsonData : JSON.parse(textData)),
      text: async () => textData,
    };
  }
  throw new Error("HTTP transport unavailable: globalThis.fetch is not defined.");
}

/**
 * Triggers a deployment or pipeline run for the specified CI/CD provider.
 * @param {string} provider - 'github', 'gitlab', or 'jenkins'
 * @param {object} options - Options containing target, ref, inputs, etc.
 * @param {object} [config={}] - Extension configuration
 * @param {function} [transport=null] - Optional HTTP fetch transport function
 * @returns {Promise<object>} Standardized pipeline trigger result
 * @public
 */
export async function triggerPipeline(provider, options = {}, config = {}, transport = null) {
  const norm = normalizeProvider(provider);
  const secrets = resolveSecrets(norm, config);
  const http = transport || defaultFetchTransport;

  let result = null;

  if (norm === "github") {
    const repo = options.repo || options.target || "owner/repo";
    const workflowId = options.workflowId || options.workflow || "deploy.yml";
    const ref = options.ref || options.branch || "main";
    const inputs = options.inputs || options.parameters || {};

    const url = `${secrets.baseUrl}/repos/${repo}/actions/workflows/${workflowId}/dispatches`;
    const headers = {
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "CmdBar-CICD",
    };
    if (secrets.token) {
      headers["Authorization"] = `Bearer ${secrets.token}`;
    }

    const resp = await http(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref, inputs }),
    });

    if (resp.status >= 200 && resp.status < 300) {
      result = {
        id: `gh-dispatch-${Date.now()}`,
        status: "queued",
        provider: "github",
        target: repo,
        workflow: workflowId,
        ref,
        webUrl: `${secrets.baseUrl.replace("api.github.com", "github.com")}/${repo}/actions`,
        createdAt: new Date().toISOString(),
        raw: { status: resp.status, dispatched: true },
      };
    } else {
      const errText = await resp.text();
      throw new Error(`GitHub Actions trigger failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
    }
  } else if (norm === "gitlab") {
    const projectId = encodeURIComponent(options.projectId || options.target || "1");
    const ref = options.ref || options.branch || "main";
    const variables = options.variables || options.inputs || [];

    const url = `${secrets.baseUrl}/api/v4/projects/${projectId}/pipeline`;
    const headers = {
      "Content-Type": "application/json",
    };
    if (secrets.token) {
      headers["PRIVATE-TOKEN"] = secrets.token;
    }

    let varsArray = [];
    if (Array.isArray(variables)) {
      varsArray = variables;
    } else if (typeof variables === "object") {
      varsArray = Object.entries(variables).map(([k, v]) => ({ key: k, value: String(v) }));
    }

    const resp = await http(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref, variables: varsArray }),
    });

    if (resp.status >= 200 && resp.status < 300) {
      const data = await resp.json();
      result = {
        id: String(data.id || `gl-pipeline-${Date.now()}`),
        status: normalizeStatus(data.status || "created"),
        provider: "gitlab",
        target: String(options.projectId || options.target || "1"),
        ref: data.ref || ref,
        webUrl: data.web_url || `${secrets.baseUrl}/${options.projectId || options.target}/pipelines/${data.id}`,
        createdAt: data.created_at || new Date().toISOString(),
        raw: data,
      };
    } else {
      const errText = await resp.text();
      throw new Error(`GitLab CI trigger failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
    }
  } else if (norm === "jenkins") {
    const jobName = encodeURIComponent(options.jobName || options.target || "deploy-job");
    const parameters = options.parameters || options.inputs || {};

    const hasParams = Object.keys(parameters).length > 0;
    const endpoint = hasParams ? "buildWithParameters" : "build";
    const url = `${secrets.baseUrl}/job/${jobName}/${endpoint}`;

    const headers = {};
    if (secrets.user && secrets.token) {
      const credentials = Buffer.from(`${secrets.user}:${secrets.token}`).toString("base64");
      headers["Authorization"] = `Basic ${credentials}`;
    } else if (secrets.token) {
      headers["Authorization"] = `Bearer ${secrets.token}`;
    }

    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(parameters)) {
      searchParams.append(k, String(v));
    }

    const fullUrl = hasParams ? `${url}?${searchParams.toString()}` : url;

    const resp = await http(fullUrl, {
      method: "POST",
      headers,
    });

    if (resp.status >= 200 && resp.status < 300) {
      result = {
        id: `jenkins-build-${Date.now()}`,
        status: "queued",
        provider: "jenkins",
        target: options.jobName || options.target || "deploy-job",
        ref: options.ref || "main",
        webUrl: `${secrets.baseUrl}/job/${jobName}`,
        createdAt: new Date().toISOString(),
        raw: { status: resp.status, queued: true },
      };
    } else {
      const errText = await resp.text();
      throw new Error(`Jenkins trigger failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
    }
  } else {
    throw new Error(`Unsupported CI/CD provider: ${provider}`);
  }

  return redactSecrets(result, [secrets.token]);
}

/**
 * Normalizes raw platform status string to standardized CmdBar status.
 * Standardized statuses: 'success', 'failed', 'running', 'queued', 'cancelled', 'unknown'.
 * @param {string} rawStatus
 * @returns {string}
 */
function normalizeStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== "string") return "unknown";
  const s = rawStatus.toLowerCase();
  if (["success", "successful", "completed", "passed"].includes(s)) return "success";
  if (["failure", "failed", "error", "unstable", "timed_out"].includes(s)) return "failed";
  if (["in_progress", "running", "building"].includes(s)) return "running";
  if (["queued", "pending", "created", "requested", "waiting", "waiting_for_resource"].includes(s)) return "queued";
  if (["cancelled", "canceled", "aborted"].includes(s)) return "cancelled";
  return "unknown";
}

/**
 * Fetches current status of a pipeline run, workflow, or build.
 * @param {string} provider - 'github', 'gitlab', or 'jenkins'
 * @param {object} options - Options containing target, runId/pipelineId/buildNumber, etc.
 * @param {object} [config={}] - Extension configuration
 * @param {function} [transport=null] - Optional HTTP fetch transport function
 * @returns {Promise<object>} Standardized pipeline status result
 * @public
 */
export async function getPipelineStatus(provider, options = {}, config = {}, transport = null) {
  const norm = normalizeProvider(provider);
  const secrets = resolveSecrets(norm, config);
  const http = transport || defaultFetchTransport;

  let result = null;

  if (norm === "github") {
    const repo = options.repo || options.target || "owner/repo";
    const runId = options.runId || options.id || options.pipelineId;

    let url = `${secrets.baseUrl}/repos/${repo}/actions/runs`;
    if (runId && String(runId).indexOf("gh-dispatch-") === -1) {
      url += `/${runId}`;
    } else {
      url += `?per_page=1`;
    }

    const headers = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "CmdBar-CICD",
    };
    if (secrets.token) {
      headers["Authorization"] = `Bearer ${secrets.token}`;
    }

    const resp = await http(url, { method: "GET", headers });
    if (resp.status >= 200 && resp.status < 300) {
      const data = await resp.json();
      const run = data.workflow_runs ? data.workflow_runs[0] : data;
      if (!run) {
        throw new Error(`No GitHub Actions workflow runs found for ${repo}`);
      }
      const rawStatus = run.conclusion || run.status || "unknown";
      result = {
        id: String(run.id),
        status: normalizeStatus(rawStatus),
        provider: "github",
        target: repo,
        ref: run.head_branch || "main",
        commit: run.head_sha || "",
        webUrl: run.html_url || `${secrets.baseUrl}/${repo}/actions/runs/${run.id}`,
        duration: run.updated_at && run.created_at ? (new Date(run.updated_at) - new Date(run.created_at)) / 1000 : 0,
        steps: (run.jobs || []).map((j) => ({ name: j.name, status: normalizeStatus(j.conclusion || j.status) })),
        raw: run,
      };
    } else {
      const errText = await resp.text();
      throw new Error(`GitHub Actions getStatus failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
    }
  } else if (norm === "gitlab") {
    const projectId = encodeURIComponent(options.projectId || options.target || "1");
    const pipelineId = options.pipelineId || options.runId || options.id;

    let url = `${secrets.baseUrl}/api/v4/projects/${projectId}/pipelines`;
    if (pipelineId && String(pipelineId).indexOf("gl-pipeline-") === -1) {
      url += `/${pipelineId}`;
    } else {
      url += `?per_page=1`;
    }

    const headers = {};
    if (secrets.token) {
      headers["PRIVATE-TOKEN"] = secrets.token;
    }

    const resp = await http(url, { method: "GET", headers });
    if (resp.status >= 200 && resp.status < 300) {
      const data = await resp.json();
      const pipeline = Array.isArray(data) ? data[0] : data;
      if (!pipeline) {
        throw new Error(`No GitLab pipelines found for project ${options.projectId || options.target}`);
      }
      result = {
        id: String(pipeline.id),
        status: normalizeStatus(pipeline.status),
        provider: "gitlab",
        target: String(options.projectId || options.target || "1"),
        ref: pipeline.ref || "main",
        commit: pipeline.sha || "",
        webUrl: pipeline.web_url || `${secrets.baseUrl}/${options.projectId}/pipelines/${pipeline.id}`,
        duration: pipeline.duration || 0,
        steps: [],
        raw: pipeline,
      };
    } else {
      const errText = await resp.text();
      throw new Error(`GitLab CI getStatus failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
    }
  } else if (norm === "jenkins") {
    const jobName = encodeURIComponent(options.jobName || options.target || "deploy-job");
    const buildNumber = options.buildNumber || options.runId || options.id || "lastBuild";

    const targetBuild = String(buildNumber).includes("jenkins-build-") ? "lastBuild" : buildNumber;
    const url = `${secrets.baseUrl}/job/${jobName}/${targetBuild}/api/json`;

    const headers = {};
    if (secrets.user && secrets.token) {
      const credentials = Buffer.from(`${secrets.user}:${secrets.token}`).toString("base64");
      headers["Authorization"] = `Basic ${credentials}`;
    } else if (secrets.token) {
      headers["Authorization"] = `Bearer ${secrets.token}`;
    }

    const resp = await http(url, { method: "GET", headers });
    if (resp.status >= 200 && resp.status < 300) {
      const data = await resp.json();
      let rawStatus = "unknown";
      if (data.building) {
        rawStatus = "building";
      } else if (data.result) {
        rawStatus = data.result;
      }
      result = {
        id: String(data.number || buildNumber),
        status: normalizeStatus(rawStatus),
        provider: "jenkins",
        target: options.jobName || options.target || "deploy-job",
        ref: options.ref || "main",
        webUrl: data.url || `${secrets.baseUrl}/job/${jobName}/${data.number}`,
        duration: (data.duration || 0) / 1000,
        steps: (data.actions || [])
          .filter((a) => a.causes)
          .map((a) => ({ name: "Cause", status: a.causes[0]?.shortDescription || "triggered" })),
        raw: data,
      };
    } else {
      const errText = await resp.text();
      throw new Error(`Jenkins getStatus failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
    }
  } else {
    throw new Error(`Unsupported CI/CD provider: ${provider}`);
  }

  return redactSecrets(result, [secrets.token]);
}

/**
 * Initiates a rollback deployment or retries a prior successful release run.
 * @param {string} provider - 'github', 'gitlab', or 'jenkins'
 * @param {object} options - Options containing target, targetRunId/priorVersion, environment, etc.
 * @param {object} [config={}] - Extension configuration
 * @param {function} [transport=null] - Optional HTTP fetch transport function
 * @returns {Promise<object>} Standardized rollback execution result
 * @public
 */
export async function rollbackPipeline(provider, options = {}, config = {}, transport = null) {
  const norm = normalizeProvider(provider);
  const secrets = resolveSecrets(norm, config);
  const http = transport || defaultFetchTransport;

  let result = null;

  if (norm === "github") {
    const repo = options.repo || options.target || "owner/repo";
    const targetRunId = options.targetRunId || options.runId;

    if (targetRunId && String(targetRunId).indexOf("gh-dispatch-") === -1) {
      const url = `${secrets.baseUrl}/repos/${repo}/actions/runs/${targetRunId}/rerun`;
      const headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CmdBar-CICD",
      };
      if (secrets.token) {
        headers["Authorization"] = `Bearer ${secrets.token}`;
      }

      const resp = await http(url, { method: "POST", headers });
      if (resp.status >= 200 && resp.status < 300) {
        result = {
          success: true,
          rollbackRunId: String(targetRunId),
          status: "triggered",
          message: `Re-run initiated for GitHub Actions run ${targetRunId}`,
          provider: "github",
          target: repo,
        };
      } else {
        const errText = await resp.text();
        throw new Error(`GitHub Actions rollback re-run failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
      }
    } else {
      return await triggerPipeline("github", {
        repo,
        workflowId: options.workflowId || "deploy.yml",
        ref: options.targetRef || options.ref || "main",
        inputs: { rollback: "true", target_ref: options.targetRef || "previous" },
      }, config, http).then((res) => ({
        success: true,
        rollbackRunId: res.id,
        status: "triggered",
        message: `Rollback workflow dispatched for GitHub Actions on ${repo}`,
        provider: "github",
        target: repo,
      }));
    }
  } else if (norm === "gitlab") {
    const projectId = encodeURIComponent(options.projectId || options.target || "1");
    const pipelineId = options.pipelineId || options.targetRunId || options.runId;

    if (pipelineId && String(pipelineId).indexOf("gl-pipeline-") === -1) {
      const url = `${secrets.baseUrl}/api/v4/projects/${projectId}/pipelines/${pipelineId}/retry`;
      const headers = {};
      if (secrets.token) {
        headers["PRIVATE-TOKEN"] = secrets.token;
      }

      const resp = await http(url, { method: "POST", headers });
      if (resp.status >= 200 && resp.status < 300) {
        const data = await resp.json();
        result = {
          success: true,
          rollbackRunId: String(data.id || pipelineId),
          status: "triggered",
          message: `GitLab CI pipeline ${pipelineId} retried for rollback`,
          provider: "gitlab",
          target: String(options.projectId || options.target || "1"),
        };
      } else {
        const errText = await resp.text();
        throw new Error(`GitLab CI rollback retry failed [${resp.status}]: ${redactSecrets(errText, [secrets.token])}`);
      }
    } else {
      return await triggerPipeline("gitlab", {
        projectId: options.projectId || options.target,
        ref: options.ref || "main",
        variables: { ROLLBACK: "true", TARGET_VERSION: options.targetRef || "previous" },
      }, config, http).then((res) => ({
        success: true,
        rollbackRunId: res.id,
        status: "triggered",
        message: `Rollback pipeline triggered for GitLab CI project ${options.projectId || options.target}`,
        provider: "gitlab",
        target: String(options.projectId || options.target || "1"),
      }));
    }
  } else if (norm === "jenkins") {
    const jobName = encodeURIComponent(options.jobName || options.target || "deploy-job");
    const targetBuild = options.targetBuild || options.buildNumber || options.targetRunId || "previous";

    return await triggerPipeline("jenkins", {
      jobName: options.jobName || options.target,
      parameters: { ACTION: "rollback", ROLLBACK_TARGET: targetBuild },
    }, config, http).then((res) => ({
      success: true,
      rollbackRunId: res.id,
      status: "triggered",
      message: `Rollback job triggered for Jenkins job ${options.jobName || options.target}`,
      provider: "jenkins",
      target: options.jobName || options.target || "deploy-job",
    }));
  } else {
    throw new Error(`Unsupported CI/CD provider: ${provider}`);
  }

  return redactSecrets(result, [secrets.token]);
}

/**
 * Checks if input command string is a CI/CD pipeline command.
 * @param {string} text
 * @returns {boolean}
 * @public
 */
export function isCICDCommand(text) {
  if (!text || typeof text !== "string") {
    return false;
  }
  return text.trim().toLowerCase().startsWith("/cicd");
}

/**
 * Parses slash command string into structured CI/CD command options.
 * @param {string} commandText
 * @returns {{ action: string, provider: string, options: object }}
 * @public
 */
export function parseCICDCommand(commandText) {
  if (!commandText || typeof commandText !== "string") {
    return { action: "unknown", provider: "unknown", options: {} };
  }

  const clean = commandText.trim().replace(/^\/cicd\s*/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { action: "status", provider: "unknown", options: {} };
  }

  const action = parts[0].toLowerCase();
  const provider = parts.length > 1 ? normalizeProvider(parts[1]) : "unknown";
  const target = parts.length > 2 ? parts[2] : "";

  const options = { target };

  if (provider === "github") {
    options.repo = target;
  } else if (provider === "gitlab") {
    options.projectId = target;
  } else if (provider === "jenkins") {
    options.jobName = target;
  }

  for (let i = 3; i < parts.length; i++) {
    const item = parts[i];
    if (item.includes("=")) {
      const [k, v] = item.split("=");
      options[k] = v;
    } else {
      if (!options.ref && !options.runId && !options.pipelineId && !options.buildNumber) {
        if (action === "status" || action === "rollback") {
          options.runId = item;
          options.pipelineId = item;
          options.buildNumber = item;
          options.targetRunId = item;
        } else {
          options.ref = item;
        }
      }
    }
  }

  return { action, provider, options };
}

/**
 * High-level manager class for CI/CD integrations in CmdBar.
 */
export class CICDPipelineManager {
  /**
   * @param {object} [config={}]
   * @param {function} [transport=null]
   */
  constructor(config = {}, transport = null) {
    this.config = config;
    this.transport = transport;
  }

  /**
   * Resolves secrets for provider.
   * @param {string} provider
   * @returns {{ token: string, user: string, baseUrl: string }}
   * @public
   */
  resolveSecrets(provider) {
    return resolveSecrets(provider, this.config);
  }

  /**
   * Redacts sensitive data.
   * @param {*} input
   * @returns {*}
   * @public
   */
  redactSecrets(input) {
    const norm = ["github", "gitlab", "jenkins"];
    const tokens = norm.map((p) => this.resolveSecrets(p).token).filter(Boolean);
    return redactSecrets(input, tokens);
  }

  /**
   * Triggers pipeline.
   * @param {string} provider
   * @param {object} options
   * @returns {Promise<object>}
   * @public
   */
  async trigger(provider, options) {
    return triggerPipeline(provider, options, this.config, this.transport);
  }

  /**
   * Fetches status.
   * @param {string} provider
   * @param {object} options
   * @returns {Promise<object>}
   * @public
   */
  async getStatus(provider, options) {
    return getPipelineStatus(provider, options, this.config, this.transport);
  }

  /**
   * Rolls back deployment.
   * @param {string} provider
   * @param {object} options
   * @returns {Promise<object>}
   * @public
   */
  async rollback(provider, options) {
    return rollbackPipeline(provider, options, this.config, this.transport);
  }

  /**
   * Parses and executes slash command string or UI command.
   * @param {string} commandText
   * @returns {Promise<object>}
   * @public
   */
  async executeCommand(commandText) {
    const { action, provider, options } = parseCICDCommand(commandText);

    if (action === "trigger" || action === "deploy") {
      return this.trigger(provider, options);
    } else if (action === "status" || action === "view") {
      return this.getStatus(provider, options);
    } else if (action === "rollback" || action === "revert") {
      return this.rollback(provider, options);
    } else {
      throw new Error(`Unknown CI/CD action '${action}'. Supported actions: trigger, status, rollback.`);
    }
  }
}
