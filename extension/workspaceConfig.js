/**
 * Workspace-Specific Configuration Management module for CmdBar.
 * Supports auto-detection from CWD, git repo integration, project templates,
 * smooth switching, and merging global and workspace configs.
 * Compatible with Node.js and GJS.
 */

import fs from "fs";
import path from "path";
import { loadConfig, saveConfig, validateConfigSchema } from "./configSync.js";

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
        name: "Node.js Scripts",
        commands: [
          { name: "Start Project", command: "npm start" },
          { name: "Run Tests", command: "npm test" },
          { name: "Build Project", command: "npm run build" },
          { name: "Install Dependencies", command: "npm install" }
        ]
      }
    ]
  },
  python: {
    name: "Python Project",
    categories: [
      {
        name: "Python Commands",
        commands: [
          { name: "Run Tests", command: "pytest" },
          { name: "Run Application", command: "python main.py" },
          { name: "Install Requirements", command: "pip install -r requirements.txt" },
          { name: "Activate Virtualenv", command: "source venv/bin/activate" }
        ]
      }
    ]
  },
  rust: {
    name: "Rust Project",
    categories: [
      {
        name: "Cargo Commands",
        commands: [
          { name: "Cargo Check", command: "cargo check" },
          { name: "Cargo Test", command: "cargo test" },
          { name: "Cargo Run", command: "cargo run" },
          { name: "Cargo Build Release", command: "cargo build --release" }
        ]
      }
    ]
  },
  go: {
    name: "Go Project",
    categories: [
      {
        name: "Go Commands",
        commands: [
          { name: "Go Test", command: "go test ./..." },
          { name: "Go Run", command: "go run ." },
          { name: "Go Build", command: "go build" },
          { name: "Go Vet", command: "go vet ./..." }
        ]
      }
    ]
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
          { name: "Compose Build", command: "docker compose build" }
        ]
      }
    ]
  },
  generic: {
    name: "Generic Project",
    categories: [
      {
        name: "Build Tasks",
        commands: [
          { name: "Make Default", command: "make" },
          { name: "Make Test", command: "make test" },
          { name: "Make Build", command: "make build" },
          { name: "Make Clean", command: "make clean" }
        ]
      }
    ]
  }
};

function fileExistsSync(filePath) {
  if (isNode) {
    try {
      if (fsModule && fsModule.existsSync) {
        return fsModule.existsSync(filePath);
      }
      return fs.existsSync(filePath);
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

function normalizePath(p) {
  if (!p) return "";
  let clean = p.replace(/\\/g, "/");
  if (clean.length > 1 && clean.endsWith("/")) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

function getParentDir(dir) {
  const norm = normalizePath(dir);
  const lastSlash = norm.lastIndexOf("/");
  if (lastSlash <= 0) {
    return lastSlash === 0 ? "/" : "";
  }
  return norm.substring(0, lastSlash);
}

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

export function findGitRepositoryRoot(startDir) {
  if (!startDir || typeof startDir !== "string") return null;
  const res = findGitRoot(startDir);
  return res ? path.resolve(res) : null;
}

export function findWorkspaceConfig(startDir) {
  if (!startDir) {
    startDir = isNode ? process.cwd() : (GLib ? GLib.get_current_dir() : "/");
  }
  let current = normalizePath(startDir);
  const gitRoot = findGitRoot(current);

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
    if (gitRoot && current === gitRoot) {
      break;
    }
    const parent = getParentDir(current);
    if (!parent || parent === current) break;
    current = parent;
  }

  return null;
}

export function findWorkspaceConfigPath(startDir) {
  if (!startDir || typeof startDir !== "string") return null;
  const ws = findWorkspaceConfig(startDir);
  return ws ? ws.configPath : null;
}

export function detectProjectType(dirPath) {
  if (!dirPath || typeof dirPath !== "string") return "generic";
  const targetDir = path.resolve(dirPath);
  if (!fs.existsSync(targetDir)) return "generic";

  if (fs.existsSync(path.join(targetDir, "package.json"))) return "node";
  if (
    fs.existsSync(path.join(targetDir, "requirements.txt")) ||
    fs.existsSync(path.join(targetDir, "pyproject.toml")) ||
    fs.existsSync(path.join(targetDir, "setup.py")) ||
    fs.existsSync(path.join(targetDir, "Pipfile"))
  ) return "python";
  if (fs.existsSync(path.join(targetDir, "Cargo.toml"))) return "rust";
  if (fs.existsSync(path.join(targetDir, "go.mod"))) return "go";
  if (fs.existsSync(path.join(targetDir, "Makefile"))) return "generic";

  return "generic";
}

export function initWorkspaceConfig(dirPath, templateName = null) {
  if (!dirPath || typeof dirPath !== "string") {
    throw new Error("Directory path is required");
  }
  const resolvedDir = path.resolve(dirPath);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const selectedTemplate = templateName && PROJECT_TEMPLATES[templateName.toLowerCase()]
    ? templateName.toLowerCase()
    : detectProjectType(resolvedDir);

  const tmpl = PROJECT_TEMPLATES[selectedTemplate] || PROJECT_TEMPLATES.generic;
  const config = {
    workspace: {
      name: path.basename(resolvedDir) || "Workspace",
      root: resolvedDir,
      template: selectedTemplate,
      created_at: new Date().toISOString()
    },
    categories: JSON.parse(JSON.stringify(tmpl.categories))
  };

  const configPath = path.join(resolvedDir, ".cmdbar.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return { config, configPath };
}

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

export function loadWorkspaceConfig(dirPath) {
  let configPath = dirPath;
  if (!dirPath || typeof dirPath !== "string") return null;

  if (!dirPath.endsWith(".json")) {
    configPath = findWorkspaceConfigPath(dirPath);
  }

  if (!configPath || !fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (validateConfigSchema(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error(`CmdBar Workspace: Error loading config at ${configPath}:`, e.message);
  }
  return null;
}

export function mergeConfigs(globalConfig, workspaceConfig) {
  const merged = JSON.parse(JSON.stringify(globalConfig || { categories: [] }));
  if (!workspaceConfig || typeof workspaceConfig !== "object") {
    return merged;
  }

  const wsName = workspaceConfig.workspace_name || (workspaceConfig.workspace && workspaceConfig.workspace.name) || "Workspace";
  const wsCategories = workspaceConfig.categories || [];

  merged._workspace = {
    active: true,
    name: wsName,
  };
  if (workspaceConfig.workspace) {
    merged._activeWorkspace = workspaceConfig.workspace;
  }

  if (workspaceConfig.ai && typeof workspaceConfig.ai === "object") {
    merged.ai = { ...(merged.ai || {}), ...workspaceConfig.ai };
  }

  const existingCatMap = new Map();
  (merged.categories || []).forEach((cat, idx) => {
    if (cat && cat.name) existingCatMap.set(cat.name, idx);
  });

  const prependedCategories = [];

  for (const wsCat of wsCategories) {
    if (!wsCat || !wsCat.name) continue;
    const catCopy = JSON.parse(JSON.stringify(wsCat));
    catCopy.workspace = true;
    if (Array.isArray(catCopy.commands)) {
      catCopy.commands.forEach((cmd) => {
        cmd.workspace = true;
      });
    }

    if (existingCatMap.has(wsCat.name)) {
      const globalCatIdx = existingCatMap.get(wsCat.name);
      const globalCmdNames = new Set(
        (merged.categories[globalCatIdx].commands || []).map((c) => c.name)
      );
      for (const cmd of catCopy.commands || []) {
        if (!globalCmdNames.has(cmd.name)) {
          merged.categories[globalCatIdx].commands.unshift(cmd);
          globalCmdNames.add(cmd.name);
        }
      }
    } else {
      prependedCategories.push(catCopy);
    }
  }

  merged.categories = [...prependedCategories, ...(merged.categories || [])];
  return merged;
}

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

export async function switchWorkspace(newCwd, globalConfigPath) {
  return await getEffectiveConfig(newCwd, globalConfigPath);
}

export class WorkspaceManager {
  constructor(options = {}) {
    this.globalConfig = options.globalConfig || { categories: [] };
    this.knownWorkspaces = new Map();
    this.activeCwd = null;
    this.activeWorkspaceConfigPath = null;
    this.activeWorkspaceConfig = null;
    this.cache = new Map();
  }

  setGlobalConfig(config) {
    this.globalConfig = config;
  }

  registerWorkspace(workspacePath, name = null) {
    const resolved = path.resolve(workspacePath);
    const info = {
      path: resolved,
      name: name || path.basename(resolved),
      registeredAt: new Date().toISOString()
    };
    this.knownWorkspaces.set(resolved, info);
    return info;
  }

  unregisterWorkspace(workspacePath) {
    const resolved = path.resolve(workspacePath);
    return this.knownWorkspaces.delete(resolved);
  }

  listWorkspaces() {
    return Array.from(this.knownWorkspaces.values());
  }

  setCurrentCwd(cwd) {
    if (!cwd) return null;
    const resolvedCwd = path.resolve(cwd);
    this.activeCwd = resolvedCwd;

    let configPath = this.cache.get(resolvedCwd);
    if (configPath === undefined) {
      configPath = findWorkspaceConfigPath(resolvedCwd);
      this.cache.set(resolvedCwd, configPath);
    }

    if (configPath) {
      this.activeWorkspaceConfigPath = configPath;
      this.activeWorkspaceConfig = loadWorkspaceConfig(configPath);
      const wsDir = path.dirname(configPath);
      this.registerWorkspace(wsDir);
    } else {
      this.activeWorkspaceConfigPath = null;
      this.activeWorkspaceConfig = null;
    }

    return this.activeWorkspaceConfig;
  }

  switchWorkspace(workspacePath) {
    const resolved = path.resolve(workspacePath);
    const configPath = findWorkspaceConfigPath(resolved);
    if (!configPath) {
      throw new Error(`No workspace config found in ${workspacePath}`);
    }
    this.activeCwd = resolved;
    this.activeWorkspaceConfigPath = configPath;
    this.activeWorkspaceConfig = loadWorkspaceConfig(configPath);
    this.registerWorkspace(resolved);
    return this.activeWorkspaceConfig;
  }

  getActiveConfig() {
    if (this.activeWorkspaceConfig) {
      return mergeConfigs(this.globalConfig, this.activeWorkspaceConfig);
    }
    return this.globalConfig;
  }

  clearCache() {
    this.cache.clear();
  }
}
