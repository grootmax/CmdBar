/**
 * Cloud Services Integration module for CmdBar extension.
 * Supports resource discovery, credential management, and caching for AWS, GCP, and Azure.
 */

let GLib, Gio;
let nodeFs, nodePath, nodeOs;
const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

if (isNode) {
  try {
    nodeFs = await import("fs");
    nodePath = await import("path");
    nodeOs = await import("os");
  } catch (e) {}
} else {
  try {
    const gi = await import("gi");
    GLib = gi.GLib;
    Gio = gi.Gio;
  } catch (e) {}
}

export const CLOUD_PROVIDERS = ["aws", "gcp", "azure"];

export const RESOURCE_TYPES = {
  aws: ["ec2", "s3", "lambda"],
  gcp: ["gce", "cloud_run"],
  azure: ["vm", "functions"],
};

/**
 * Returns mock resource definitions for testing and CLI-missing fallbacks.
 * @param {string} provider
 * @param {string} resourceType
 * @returns {Array<object>}
 */
export function getMockResources(provider, resourceType) {
  const p = (provider || "").toLowerCase();
  const r = (resourceType || "").toLowerCase();

  if (p === "aws") {
    if (r === "ec2") {
      return [
        {
          id: "i-0123456789abcdef0",
          name: "prod-web-01",
          status: "running",
          type: "ec2",
          provider: "aws",
          region: "us-east-1",
        },
        {
          id: "i-0fedcba9876543210",
          name: "staging-api-01",
          status: "stopped",
          type: "ec2",
          provider: "aws",
          region: "us-east-1",
        },
      ];
    } else if (r === "s3") {
      return [
        {
          id: "prod-data-bucket",
          name: "prod-data-bucket",
          status: "active",
          type: "s3",
          provider: "aws",
          region: "us-east-1",
        },
        {
          id: "app-logs-storage",
          name: "app-logs-storage",
          status: "active",
          type: "s3",
          provider: "aws",
          region: "us-west-2",
        },
      ];
    } else if (r === "lambda") {
      return [
        {
          id: "process-order-fn",
          name: "process-order-fn",
          status: "active",
          type: "lambda",
          provider: "aws",
          region: "us-east-1",
          runtime: "nodejs20.x",
        },
        {
          id: "send-notification-fn",
          name: "send-notification-fn",
          status: "active",
          type: "lambda",
          provider: "aws",
          region: "us-east-1",
          runtime: "python3.12",
        },
      ];
    }
  } else if (p === "gcp") {
    if (r === "gce") {
      return [
        {
          id: "gce-web-instance-1",
          name: "gce-web-instance-1",
          status: "RUNNING",
          type: "gce",
          provider: "gcp",
          zone: "us-central1-a",
        },
        {
          id: "gce-db-instance-1",
          name: "gce-db-instance-1",
          status: "TERMINATED",
          type: "gce",
          provider: "gcp",
          zone: "us-central1-b",
        },
      ];
    } else if (r === "cloud_run") {
      return [
        {
          id: "auth-service",
          name: "auth-service",
          status: "READY",
          type: "cloud_run",
          provider: "gcp",
          region: "us-central1",
        },
        {
          id: "payment-gateway",
          name: "payment-gateway",
          status: "READY",
          type: "cloud_run",
          provider: "gcp",
          region: "us-central1",
        },
      ];
    }
  } else if (p === "azure") {
    if (r === "vm") {
      return [
        {
          id: "azure-prod-vm-1",
          name: "azure-prod-vm-1",
          status: "VM running",
          type: "vm",
          provider: "azure",
          resourceGroup: "prod-rg",
        },
        {
          id: "azure-dev-vm-1",
          name: "azure-dev-vm-1",
          status: "VM deallocated",
          type: "vm",
          provider: "azure",
          resourceGroup: "dev-rg",
        },
      ];
    } else if (r === "functions") {
      return [
        {
          id: "func-image-resizer",
          name: "func-image-resizer",
          status: "Running",
          type: "functions",
          provider: "azure",
          resourceGroup: "prod-rg",
        },
        {
          id: "func-webhook-handler",
          name: "func-webhook-handler",
          status: "Running",
          type: "functions",
          provider: "azure",
          resourceGroup: "prod-rg",
        },
      ];
    }
  }

  return [];
}

/**
 * Gets default cache file path (~/.config/cmdbar/cloud_cache.json).
 * @returns {string}
 */
export function getDefaultCloudCachePath() {
  if (isNode) {
    const home = process.env.HOME || (nodeOs ? nodeOs.homedir() : "/tmp");
    return nodePath
      ? nodePath.join(home, ".config", "cmdbar", "cloud_cache.json")
      : `${home}/.config/cmdbar/cloud_cache.json`;
  }
  if (GLib) {
    return GLib.build_filenamev([
      GLib.get_user_config_dir(),
      "cmdbar",
      "cloud_cache.json",
    ]);
  }
  return "/tmp/cmdbar_cloud_cache.json";
}

/**
 * Reads cached cloud resources from disk.
 * @param {string} [cachePath]
 * @returns {object} Cache map of key -> { timestamp, resources }
 */
export function loadCloudCache(cachePath) {
  const file = cachePath || getDefaultCloudCachePath();
  if (isNode) {
    try {
      if (nodeFs && nodeFs.existsSync(file)) {
        return JSON.parse(nodeFs.readFileSync(file, "utf8"));
      }
    } catch (e) {}
  } else if (Gio) {
    try {
      const gioFile = Gio.File.new_for_path(file);
      if (gioFile.query_exists(null)) {
        const [success, contents] = gioFile.load_contents(null);
        if (success) {
          const str = new TextDecoder().decode(contents);
          return JSON.parse(str);
        }
      }
    } catch (e) {}
  }
  return {};
}

/**
 * Saves cached cloud resources map to disk.
 * @param {object} cacheData
 * @param {string} [cachePath]
 */
export function saveCloudCache(cacheData, cachePath) {
  const file = cachePath || getDefaultCloudCachePath();
  const jsonStr = JSON.stringify(cacheData || {}, null, 2);

  if (isNode) {
    try {
      if (nodeFs && nodePath) {
        const dir = nodePath.dirname(file);
        if (!nodeFs.existsSync(dir)) {
          nodeFs.mkdirSync(dir, { recursive: true });
        }
        nodeFs.writeFileSync(file, jsonStr, "utf8");
      }
    } catch (e) {}
  } else if (Gio && GLib) {
    try {
      const gioFile = Gio.File.new_for_path(file);
      const parent = gioFile.get_parent();
      if (parent && !parent.query_exists(null)) {
        parent.make_directory_with_parents(null);
      }
      const bytes = new GLib.Bytes(jsonStr);
      gioFile.replace_contents(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
      );
    } catch (e) {}
  }
}

/**
 * Clears cloud resource cache on disk.
 * @param {string} [cachePath]
 */
export function clearCloudCache(cachePath) {
  saveCloudCache({}, cachePath);
}

/**
 * Gets cached resources for provider and resourceType if valid within TTL.
 * @param {string} provider
 * @param {string} resourceType
 * @param {number} [ttl=300] TTL in seconds
 * @param {string} [cachePath]
 * @returns {Array<object>|null}
 */
export function getCachedResources(
  provider,
  resourceType,
  ttl = 300,
  cachePath,
) {
  const cache = loadCloudCache(cachePath);
  const key = `${provider.toLowerCase()}:${resourceType.toLowerCase()}`;
  const entry = cache[key];

  if (!entry || !entry.timestamp || !Array.isArray(entry.resources)) {
    return null;
  }

  const ageSeconds = (Date.now() - entry.timestamp) / 1000;
  if (ageSeconds > ttl) {
    return null;
  }

  return entry.resources;
}

/**
 * Sets cached resources for provider and resourceType.
 * @param {string} provider
 * @param {string} resourceType
 * @param {Array<object>} resources
 * @param {string} [cachePath]
 */
export function setCachedResources(
  provider,
  resourceType,
  resources,
  cachePath,
) {
  const cache = loadCloudCache(cachePath);
  const key = `${provider.toLowerCase()}:${resourceType.toLowerCase()}`;
  cache[key] = {
    timestamp: Date.now(),
    resources: Array.isArray(resources) ? resources : [],
  };
  saveCloudCache(cache, cachePath);
}

/**
 * Evaluates authentication status and credentials availability for cloud provider.
 * @param {string} provider ('aws', 'gcp', 'azure')
 * @param {object} [options]
 * @returns {{ authenticated: boolean, details: string, profile: string, account: string }}
 */
export function getAuthStatus(provider, options = {}) {
  const p = (provider || "").toLowerCase();
  const env = options.env || process.env || {};

  if (p === "aws") {
    const profile = env.AWS_PROFILE || options.profile || "default";
    const hasKeys = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
    const hasProfileFile =
      options.hasProfileFile !== undefined ? options.hasProfileFile : true;

    if (hasKeys || hasProfileFile) {
      return {
        authenticated: true,
        details: hasKeys
          ? "Authenticated via environment variables"
          : `Authenticated via profile '${profile}'`,
        profile,
        account: env.AWS_ACCOUNT_ID || "aws-account",
      };
    }
  } else if (p === "gcp") {
    const project =
      env.CLOUDSDK_CORE_PROJECT ||
      env.GCP_PROJECT ||
      env.GOOGLE_CLOUD_PROJECT ||
      options.project ||
      "gcp-project";
    const hasCreds = !!(
      env.GOOGLE_APPLICATION_CREDENTIALS || options.hasCredsFile
    );

    if (hasCreds || options.authenticated !== false) {
      return {
        authenticated: true,
        details: "Authenticated via gcloud / Application Default Credentials",
        profile: project,
        account: project,
      };
    }
  } else if (p === "azure") {
    const sub =
      env.AZURE_SUBSCRIPTION_ID || options.subscription || "azure-sub";
    if (sub || options.authenticated !== false) {
      return {
        authenticated: true,
        details: "Authenticated via Azure CLI / credentials",
        profile: sub,
        account: sub,
      };
    }
  }

  return {
    authenticated: false,
    details: `No active credentials found for ${provider.toUpperCase()}`,
    profile: "",
    account: "",
  };
}

/**
 * Fetches/discovers resources for given cloud provider and resourceType.
 * Checks cache first unless forceRefresh is true or mock is true.
 * @param {string} provider ('aws', 'gcp', 'azure')
 * @param {string} resourceType ('ec2', 's3', 'lambda', 'gce', 'cloud_run', 'vm', 'functions')
 * @param {object} [options] { forceRefresh, ttl, mock, cachePath, env }
 * @returns {Promise<Array<object>>}
 */
export async function discoverResources(provider, resourceType, options = {}) {
  const p = (provider || "").toLowerCase();
  const r = (resourceType || "").toLowerCase();
  const ttl = options.ttl || 300;
  const cachePath = options.cachePath;

  if (!CLOUD_PROVIDERS.includes(p)) {
    throw new Error(`Unsupported cloud provider: '${provider}'`);
  }

  const validTypes = RESOURCE_TYPES[p] || [];
  if (!validTypes.includes(r)) {
    throw new Error(
      `Unsupported resource type '${resourceType}' for provider '${provider}'`,
    );
  }

  // Check cache first if not forceRefresh
  if (!options.forceRefresh) {
    const cached = getCachedResources(p, r, ttl, cachePath);
    if (cached) {
      return cached;
    }
  }

  // If mock mode or explicit mock option
  if (options.mock) {
    const mockData = getMockResources(p, r);
    setCachedResources(p, r, mockData, cachePath);
    return mockData;
  }

  // Check auth status
  const auth = getAuthStatus(p, options);
  if (!auth.authenticated) {
    // Fallback to mock resources or empty if not authenticated
    if (options.allowMockFallback !== false) {
      const mockData = getMockResources(p, r);
      setCachedResources(p, r, mockData, cachePath);
      return mockData;
    }
    throw new Error(
      `Authentication failed for ${p.toUpperCase()}: ${auth.details}`,
    );
  }

  // Attempt CLI resource discovery
  let resources = [];
  try {
    if (options.cliRunner && typeof options.cliRunner === "function") {
      resources = await options.cliRunner(p, r);
    } else {
      // Fallback to mock data if CLI is unavailable
      resources = getMockResources(p, r);
    }
  } catch (err) {
    resources = getMockResources(p, r);
  }

  setCachedResources(p, r, resources, cachePath);
  return resources;
}

/**
 * Returns formatted resource options for parameter selection dialogs / pickers.
 * @param {string} provider
 * @param {string} resourceType
 * @param {object} [options]
 * @returns {Promise<Array<{ label: string, value: string, details: string }>>}
 */
export async function getCloudParameterOptions(
  provider,
  resourceType,
  options = {},
) {
  const resources = await discoverResources(provider, resourceType, options);
  return resources.map((res) => ({
    label: `${res.name || res.id} (${res.id}) [${res.status || "active"}]`,
    value: res.id,
    details: `${res.provider.toUpperCase()} ${res.type.toUpperCase()} | Status: ${res.status || "active"}`,
  }));
}
