import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  PROJECT_TEMPLATES,
  findGitRepositoryRoot,
  findWorkspaceConfigPath,
  detectProjectType,
  initWorkspaceConfig,
  loadWorkspaceConfig,
  mergeConfigs,
  WorkspaceManager
} from '../extension/workspaceConfig.js';

describe('Workspace-Specific Configs Unit & Integration Tests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdbar-ws-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Git Repository Integration & Detection', () => {
    test('findGitRepositoryRoot detects git root from nested subdirectory', () => {
      const gitDir = path.join(tempDir, 'my-repo');
      const subDir = path.join(gitDir, 'src', 'components');
      fs.mkdirSync(path.join(gitDir, '.git'), { recursive: true });
      fs.mkdirSync(subDir, { recursive: true });

      const foundRoot = findGitRepositoryRoot(subDir);
      expect(foundRoot).toBe(gitDir);
    });

    test('findGitRepositoryRoot returns null when outside git repository', () => {
      const nonGitDir = path.join(tempDir, 'not-a-repo');
      fs.mkdirSync(nonGitDir, { recursive: true });

      expect(findGitRepositoryRoot(nonGitDir)).toBeNull();
    });
  });

  describe('Auto-detection of Workspace Configs', () => {
    test('findWorkspaceConfigPath finds .cmdbar.json in current directory', () => {
      const wsDir = path.join(tempDir, 'project-a');
      fs.mkdirSync(wsDir, { recursive: true });
      const configFile = path.join(wsDir, '.cmdbar.json');
      fs.writeFileSync(configFile, JSON.stringify({ categories: [] }));

      expect(findWorkspaceConfigPath(wsDir)).toBe(configFile);
    });

    test('findWorkspaceConfigPath finds .cmdbar/config.json directory format', () => {
      const wsDir = path.join(tempDir, 'project-b');
      const cfgDir = path.join(wsDir, '.cmdbar');
      fs.mkdirSync(cfgDir, { recursive: true });
      const configFile = path.join(cfgDir, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify({ categories: [] }));

      expect(findWorkspaceConfigPath(wsDir)).toBe(configFile);
    });

    test('findWorkspaceConfigPath stops at git root when searching parent directories', () => {
      const gitRoot = path.join(tempDir, 'repo-root');
      const subFolder = path.join(gitRoot, 'sub', 'deep');
      fs.mkdirSync(path.join(gitRoot, '.git'), { recursive: true });
      fs.mkdirSync(subFolder, { recursive: true });

      // Config outside git root should not be reached
      const outsideConfig = path.join(tempDir, '.cmdbar.json');
      fs.writeFileSync(outsideConfig, JSON.stringify({ categories: [] }));

      expect(findWorkspaceConfigPath(subFolder)).toBeNull();
    });
  });

  describe('Project Type Detection & Templates', () => {
    test('detectProjectType correctly identifies Node.js project', () => {
      const dir = path.join(tempDir, 'node-proj');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');

      expect(detectProjectType(dir)).toBe('node');
    });

    test('detectProjectType correctly identifies Python project', () => {
      const dir = path.join(tempDir, 'py-proj');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pytest');

      expect(detectProjectType(dir)).toBe('python');
    });

    test('detectProjectType correctly identifies Rust project', () => {
      const dir = path.join(tempDir, 'rust-proj');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Cargo.toml'), '');

      expect(detectProjectType(dir)).toBe('rust');
    });

    test('detectProjectType correctly identifies Go project', () => {
      const dir = path.join(tempDir, 'go-proj');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'go.mod'), '');

      expect(detectProjectType(dir)).toBe('go');
    });

    test('detectProjectType defaults to generic project', () => {
      const dir = path.join(tempDir, 'custom-proj');
      fs.mkdirSync(dir, { recursive: true });

      expect(detectProjectType(dir)).toBe('generic');
    });
  });

  describe('Workspace Initialization & Loading', () => {
    test('initWorkspaceConfig creates valid .cmdbar.json from specified template', () => {
      const wsDir = path.join(tempDir, 'new-node-app');
      const { config, configPath } = initWorkspaceConfig(wsDir, 'node');

      expect(fs.existsSync(configPath)).toBe(true);
      expect(config.workspace.template).toBe('node');
      expect(config.categories.length).toBeGreaterThan(0);
      expect(config.categories[0].commands.some(c => c.command === 'npm test')).toBe(true);
    });

    test('loadWorkspaceConfig loads and validates initialized config', () => {
      const wsDir = path.join(tempDir, 'new-py-app');
      initWorkspaceConfig(wsDir, 'python');

      const loaded = loadWorkspaceConfig(wsDir);
      expect(loaded).not.toBeNull();
      expect(loaded.categories[0].name).toBe('Python Commands');
    });

    test('loadWorkspaceConfig returns null for invalid JSON or missing schema', () => {
      const wsDir = path.join(tempDir, 'broken-app');
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, '.cmdbar.json'), 'invalid json{{{');

      expect(loadWorkspaceConfig(wsDir)).toBeNull();
    });
  });

  describe('Smooth Config Merging', () => {
    test('mergeConfigs prepends workspace categories to global config', () => {
      const globalCfg = {
        categories: [
          { name: 'Global Utility', commands: [{ name: 'Echo', command: 'echo hi' }] }
        ]
      };
      const wsCfg = {
        categories: [
          { name: 'Project Specific', commands: [{ name: 'Build', command: 'npm run build' }] }
        ]
      };

      const merged = mergeConfigs(globalCfg, wsCfg);
      expect(merged.categories.length).toBe(2);
      expect(merged.categories[0].name).toBe('Project Specific');
      expect(merged.categories[1].name).toBe('Global Utility');
    });

    test('mergeConfigs merges commands within matching category names without duplicates', () => {
      const globalCfg = {
        categories: [
          { name: 'Build Tasks', commands: [{ name: 'Global Build', command: 'make global' }] }
        ]
      };
      const wsCfg = {
        categories: [
          { name: 'Build Tasks', commands: [{ name: 'WS Build', command: 'make ws' }] }
        ]
      };

      const merged = mergeConfigs(globalCfg, wsCfg);
      expect(merged.categories.length).toBe(1);
      expect(merged.categories[0].commands.length).toBe(2);
      expect(merged.categories[0].commands[0].name).toBe('WS Build');
    });
  });

  describe('WorkspaceManager & Smooth Switching', () => {
    test('WorkspaceManager auto-detects cwd and switches active config', () => {
      const globalCfg = {
        categories: [{ name: 'Global', commands: [{ name: 'Top', command: 'top' }] }]
      };
      const manager = new WorkspaceManager({ globalConfig: globalCfg });

      const nodeDir = path.join(tempDir, 'proj-node');
      initWorkspaceConfig(nodeDir, 'node');

      manager.setCurrentCwd(nodeDir);
      const activeCfg = manager.getActiveConfig();

      expect(activeCfg.categories.some(c => c.name === 'Node.js Scripts')).toBe(true);
      expect(activeCfg.categories.some(c => c.name === 'Global')).toBe(true);
    });

    test('WorkspaceManager switches between different project workspaces smoothly', () => {
      const manager = new WorkspaceManager();

      const pyDir = path.join(tempDir, 'proj-py');
      const rustDir = path.join(tempDir, 'proj-rust');

      initWorkspaceConfig(pyDir, 'python');
      initWorkspaceConfig(rustDir, 'rust');

      manager.switchWorkspace(pyDir);
      expect(manager.getActiveConfig().categories[0].name).toBe('Python Commands');

      manager.switchWorkspace(rustDir);
      expect(manager.getActiveConfig().categories[0].name).toBe('Cargo Commands');
    });
  });

  describe('Performance Benchmark Requirements', () => {
    test('Workspace auto-detection and config switching completes under 5ms benchmark', () => {
      const wsDir = path.join(tempDir, 'perf-proj');
      const subDir = path.join(wsDir, 'src', 'app');
      fs.mkdirSync(subDir, { recursive: true });
      initWorkspaceConfig(wsDir, 'node');

      const manager = new WorkspaceManager();

      const start = performance.now();
      for (let i = 0; i < 50; i++) {
        manager.setCurrentCwd(subDir);
        manager.getActiveConfig();
      }
      const elapsed = performance.now() - start;
      const averageMs = elapsed / 50;

      expect(averageMs).toBeLessThan(5);
    });
  });
});
