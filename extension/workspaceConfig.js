import fs from 'fs';
import path from 'path';
import { validateConfigSchema } from './configSync.js';

export const PROJECT_TEMPLATES = {
  node: {
    name: "Node.js",
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
    name: "Python",
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
    name: "Rust",
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
    name: "Go",
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

/**
 * Finds the Git repository root starting from startDir and searching upwards.
 * @param {string} startDir 
 * @returns {string|null} Absolute path to git root directory or null
 */
export function findGitRepositoryRoot(startDir) {
  if (!startDir || typeof startDir !== 'string') return null;
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      return current;
    }
    if (current === root) break;
    current = path.dirname(current);
  }
  return null;
}

/**
 * Finds a workspace config file (.cmdbar.json or .cmdbar/config.json)
 * searching upwards from startDir up to git root or filesystem root.
 * @param {string} startDir 
 * @returns {string|null} Absolute path to workspace config file or null
 */
export function findWorkspaceConfigPath(startDir) {
  if (!startDir || typeof startDir !== 'string') return null;
  let current = path.resolve(startDir);
  const gitRoot = findGitRepositoryRoot(current);
  const root = path.parse(current).root;

  while (current) {
    const fileConfig = path.join(current, '.cmdbar.json');
    if (fs.existsSync(fileConfig)) {
      return fileConfig;
    }
    const dirConfig = path.join(current, '.cmdbar', 'config.json');
    if (fs.existsSync(dirConfig)) {
      return dirConfig;
    }
    if (gitRoot && current === gitRoot) {
      break;
    }
    if (current === root) break;
    current = path.dirname(current);
  }
  return null;
}

/**
 * Detects the project type based on indicator files in directory or git root.
 * @param {string} dirPath 
 * @returns {string} Template name ('node', 'python', 'rust', 'go', 'generic')
 */
export function detectProjectType(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return 'generic';
  const targetDir = path.resolve(dirPath);
  if (!fs.existsSync(targetDir)) return 'generic';

  if (fs.existsSync(path.join(targetDir, 'package.json'))) return 'node';
  if (
    fs.existsSync(path.join(targetDir, 'requirements.txt')) ||
    fs.existsSync(path.join(targetDir, 'pyproject.toml')) ||
    fs.existsSync(path.join(targetDir, 'setup.py')) ||
    fs.existsSync(path.join(targetDir, 'Pipfile'))
  ) return 'python';
  if (fs.existsSync(path.join(targetDir, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(targetDir, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(targetDir, 'Makefile'))) return 'generic';

  return 'generic';
}

/**
 * Initializes a workspace-specific configuration file using a specified or detected template.
 * @param {string} dirPath Workspace root directory
 * @param {string} [templateName] Optional template name
 * @returns {{ config: object, configPath: string }}
 */
export function initWorkspaceConfig(dirPath, templateName = null) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('Directory path is required');
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

  const configPath = path.join(resolvedDir, '.cmdbar.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return { config, configPath };
}

/**
 * Loads a workspace-specific configuration file.
 * @param {string} dirPath Path to project directory or directly to config file
 * @returns {object|null} Workspace config object or null if not found/invalid
 */
export function loadWorkspaceConfig(dirPath) {
  let configPath = dirPath;
  if (!dirPath || typeof dirPath !== 'string') return null;

  if (!dirPath.endsWith('.json')) {
    configPath = findWorkspaceConfigPath(dirPath);
  }

  if (!configPath || !fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (validateConfigSchema(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error(`CmdBar Workspace: Error loading config at ${configPath}:`, e.message);
  }
  return null;
}

/**
 * Merges workspace-specific configuration into global configuration.
 * Workspace categories/commands are prepended or merged into global config.
 * @param {object} globalConfig 
 * @param {object} workspaceConfig 
 * @returns {object} Merged configuration object
 */
export function mergeConfigs(globalConfig, workspaceConfig) {
  if (!globalConfig) return workspaceConfig || { categories: [] };
  if (!workspaceConfig) return globalConfig;

  const merged = JSON.parse(JSON.stringify(globalConfig));
  const wsCategories = JSON.parse(JSON.stringify(workspaceConfig.categories || []));

  const existingCatMap = new Map();
  (merged.categories || []).forEach((cat, idx) => {
    existingCatMap.set(cat.name, idx);
  });

  const prependedCategories = [];

  for (const wsCat of wsCategories) {
    if (existingCatMap.has(wsCat.name)) {
      const globalCatIdx = existingCatMap.get(wsCat.name);
      const globalCmdNames = new Set(
        (merged.categories[globalCatIdx].commands || []).map(c => c.name)
      );
      for (const cmd of (wsCat.commands || [])) {
        if (!globalCmdNames.has(cmd.name)) {
          merged.categories[globalCatIdx].commands.unshift(cmd);
          globalCmdNames.add(cmd.name);
        }
      }
    } else {
      prependedCategories.push(wsCat);
    }
  }

  merged.categories = [...prependedCategories, ...(merged.categories || [])];

  if (workspaceConfig.ai) {
    merged.ai = { ...merged.ai, ...workspaceConfig.ai };
  }

  if (workspaceConfig.workspace) {
    merged._activeWorkspace = workspaceConfig.workspace;
  }

  return merged;
}

/**
 * WorkspaceManager manages active workspace state, auto-detection, switching, and registry.
 */
export class WorkspaceManager {
  constructor(options = {}) {
    this.globalConfig = options.globalConfig || { categories: [] };
    this.knownWorkspaces = new Map(); // workspacePath -> info
    this.activeCwd = null;
    this.activeWorkspaceConfigPath = null;
    this.activeWorkspaceConfig = null;
    this.cache = new Map(); // cwd -> detected config path
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
