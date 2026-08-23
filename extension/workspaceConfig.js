/**
 * Workspace-Specific Configuration Management module for CmdBar.
 * Supports auto-detection from CWD, git repo integration, project templates,
 * smooth switching, and merging global and workspace configs.
 * Compatible with Node.js and GJS.
 */

import { loadConfig, saveConfig } from "./configSync.js";

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib, fsModule;
if (isNode) {
  try {
    fsModule = await import("fs");
  } catch (e) {}
} else {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

export const WORKSPACE_FILE_NAMES = [".cmdbar.json", ".cmdbar/config.json"];

export const PROJECT_TEMPLATES = {
  node: {
    name: "Node.js Project",
    categories: [
      {
        name: "Node.js",
        commands: [
          { name: "NPM Install", command: "npm install" },
          { name: "NPM Test", command: "npm test" },
          { name: "NPM Start", command: "npm start" },
          { name: "NPM Build", command: "npm run build" },
          { name: "NPM Lint", command: "npm run lint" },
        ],
      },
    ],
  },
  python: {
    name: "Python Project",
    categories: [
      {
        name: "Python",
        commands: [
          { name: "Run Tests", command: "pytest" },
          { name: "Run Main", command: "python main.py" },
          { name: "Install Requirements", command: "pip install -r requirements.txt" },
          { name: "Ruff Check", command: "ruff check ." },
        ],
      },
    ],
  },
  rust: {
    name: "Rust Project",
    categories: [
      {
        name: "Rust",
        commands: [
          { name: "Cargo Build", command: "cargo build" },
          { name: "Cargo Test", command: "cargo test" },
          { name: "Cargo Run", command: "cargo run" },
          { name: "Cargo Check", command: "cargo check" },
        ],
      },
    ],
  },
  go: {
    name: "Go Project",
    categories: [
      {
        name: "Go",
        commands: [
          { name: "Go Build", command: "go build ." },
          { name: "Go Test", command: "go test ./..." },
          { name: "Go Run", command: "go run ." },
        ],
      },
    ],
  },
  docker: {
    name: "Docker Container Workspace",
    categories: [
      {
        name: "Docker",
        commands: [
          { name: "Compose Up", command: "docker compose up -d" },
          { name: "Compose Down", command: "docker compose down" },
          { name: "Compose Logs", command: "docker compose logs -f" },
          { name: "Compose Build", command: "docker compose build" },
        ],
      },
    ],
  },
  generic: {
    name: "Generic Workspace",
    categories: [
      {
        name: "Workspace Commands",
        commands: [
          { name: "Build Project", command: "make build" },
          { name: "Test Project", command: "make test" },
          { name: "Git Status", command: "git status" },
        ],
      },
    ],
  },
};

/**
 * Checks if a file exists synchronously.
 */
function fileExistsSync(filePath) {
  if (isNode) {
    try {
      if (fsModule && fsModule.existsSync) {
        return fsModule.existsSync(filePath);
      }
      return false;
    } catch (e) {
      return false;
    }
  } else {
    try {
      let file = Gio.File.new_for_path(filePath);
      return file.query_exists(null);
    } catch (e) {
      return false;
    }
  }
}

/**
 * Normalizes a path string.
 */
function normalizePath(p) {
  if (!p) return "";
  let clean = p.replace(/\\/g, "/");
  if (clean.length > 1 && clean.endsWith("/")) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

/**
 * Finds the parent directory of a given path.
 */
function getParentDir(dir) {
  const norm = normalizePath(dir);
  const lastSlash = norm.lastIndexOf("/");
  if (lastSlash <= 0) {
    return lastSlash === 0 ? "/" : "";
  }
  return norm.substring(0, lastSlash);
}

/**
 * Joins path segments cleanly.
 */
function joinPaths(...parts) {
  return parts
    .map((p, i) => {
      let norm = normalizePath(p);
      if (i > 0 && norm.startsWith("/")) norm = norm.slice(1);
      return norm;
    })
    .filter(Boolean)
    .join("/");
}

/**
 * Auto-detects Git repository root directory from startDir upwards.
 * @param {string} [startDir]
 * @returns {string|null} Path to directory containing .git or null.
 */
export function findGitRoot(startDir) {
  if (!startDir) {
    startDir = isNode ? process.cwd() : (GLib ? GLib.get_current_dir() : "/");
  }
  let current = normalizePath(startDir);
  while (current) {
    const gitPath = joinPaths(current, ".git");
    if (fileExistsSync(gitPath)) {
      return current;
    }
    const parent = getParentDir(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Auto-detects workspace configuration file starting from startDir.
 * Traverses upwards searching for .cmdbar.json or .cmdbar/config.json.
 * @param {string} [startDir]
 * @returns {{ configPath: string, workspaceDir: string, filename: string } | null}
 */
export function findWorkspaceConfig(startDir) {
  if (!startDir) {
    startDir = isNode ? process.cwd() : (GLib ? GLib.get_current_dir() : "/");
  }
  let current = normalizePath(startDir);

  while (current) {
    for (const name of WORKSPACE_FILE_NAMES) {
      const candidate = joinPaths(current, name);
      if (fileExistsSync(candidate)) {
        return {
          configPath: candidate,
          workspaceDir: current,
          filename: name,
        };
      }
    }
    const parent = getParentDir(current);
    if (!parent || parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Creates/initializes a workspace configuration file in targetDir from a template or custom config.
 * @param {string} targetDir
 * @param {string} [templateName="generic"]
 * @param {object} [customConfig=null]
 * @returns {Promise<{ configPath: string, workspaceDir: string, config: object }>}
 */
export async function createWorkspaceConfig(targetDir, templateName = "generic", customConfig = null) {
  if (!targetDir) {
    targetDir = isNode ? process.cwd() : (GLib ? GLib.get_current_dir() : "/");
  }
  const normDir = normalizePath(targetDir);
  const configPath = joinPaths(normDir, ".cmdbar.json");

  let baseTemplate = customConfig;
  if (!baseTemplate) {
    const templateKey = (templateName || "generic").toLowerCase();
    const tmplObj = PROJECT_TEMPLATES[templateKey] || PROJECT_TEMPLATES.generic;
    baseTemplate = JSON.parse(JSON.stringify(tmplObj));
  } else {
    baseTemplate = JSON.parse(JSON.stringify(customConfig));
  }

  const dirName = normDir.split("/").pop();
  const workspaceName =
    (customConfig && (customConfig.workspace_name || customConfig.name)) ||
    dirName ||
    baseTemplate.name ||
    "Workspace";
  const configData = {
    workspace_name: workspaceName,
    ai: baseTemplate.ai || {},
    categories: baseTemplate.categories || [],
  };

  await saveConfig(configData, configPath);

  return {
    configPath,
    workspaceDir: normDir,
    config: configData,
  };
}

/**
 * Merges a global config and a workspace config smoothly.
 * Workspace categories and commands take precedence or extend global categories.
 * @param {object} globalConfig
 * @param {object} workspaceConfig
 * @returns {object} Merged effective configuration.
 */
export function mergeConfigs(globalConfig, workspaceConfig) {
  const merged = JSON.parse(JSON.stringify(globalConfig || { categories: [] }));
  if (!workspaceConfig || typeof workspaceConfig !== "object") {
    return merged;
  }

  const wsName = workspaceConfig.workspace_name || "Workspace";
  const wsCategories = workspaceConfig.categories || [];

  merged._workspace = {
    active: true,
    name: wsName,
  };

  if (workspaceConfig.ai && typeof workspaceConfig.ai === "object") {
    merged.ai = { ...(merged.ai || {}), ...workspaceConfig.ai };
  }

  const mergedCategories = [];

  for (const cat of wsCategories) {
    if (!cat || !cat.name) continue;
    const catCopy = JSON.parse(JSON.stringify(cat));
    catCopy.workspace = true;
    if (Array.isArray(catCopy.commands)) {
      catCopy.commands.forEach((cmd) => {
        cmd.workspace = true;
      });
    }
    mergedCategories.push(catCopy);
  }

  for (const cat of merged.categories || []) {
    if (!cat || !cat.name) continue;
    const existingWsCat = mergedCategories.find((c) => c.name === cat.name);
    if (existingWsCat) {
      if (Array.isArray(cat.commands)) {
        existingWsCat.commands = existingWsCat.commands || [];
        const wsCmdNames = new Set(existingWsCat.commands.map((c) => c.name));
        for (const cmd of cat.commands) {
          if (!wsCmdNames.has(cmd.name)) {
            existingWsCat.commands.push(JSON.parse(JSON.stringify(cmd)));
          }
        }
      }
    } else {
      mergedCategories.push(JSON.parse(JSON.stringify(cat)));
    }
  }

  merged.categories = mergedCategories;
  return merged;
}

/**
 * Loads effective config, auto-detecting workspace config from cwd and merging with global config.
 * @param {string} [cwd]
 * @param {string} [globalConfigPath]
 * @param {string} [extensionPath]
 * @returns {Promise<object>}
 */
export async function getEffectiveConfig(cwd, globalConfigPath, extensionPath) {
  if (!cwd) {
    cwd = isNode ? process.cwd() : (GLib ? GLib.get_current_dir() : "/");
  }
  const globalConfig = await loadConfig(globalConfigPath, extensionPath);
  const wsInfo = findWorkspaceConfig(cwd);

  if (!wsInfo) {
    return globalConfig;
  }

  try {
    const wsConfig = await loadConfig(wsInfo.configPath);
    const merged = mergeConfigs(globalConfig, wsConfig);
    merged._workspace.dir = wsInfo.workspaceDir;
    merged._workspace.configPath = wsInfo.configPath;
    return merged;
  } catch (e) {
    return globalConfig;
  }
}

/**
 * Smoothly switches workspace to a new cwd and returns updated effective config.
 * @param {string} newCwd
 * @param {string} [globalConfigPath]
 * @returns {Promise<object>}
 */
export async function switchWorkspace(newCwd, globalConfigPath) {
  return await getEffectiveConfig(newCwd, globalConfigPath);
}
