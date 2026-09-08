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
  WorkspaceManager,
  findGitRoot,
  findWorkspaceConfig,
  createWorkspaceConfig,
  getEffectiveConfig,
  switchWorkspace,
  WORKSPACE_FILE_NAMES,
} from '../extension/workspaceConfig.js';
import { saveConfig } from '../extension/configSync.js';

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

    test('findGitRoot detects git root when .git directory exists', () => {
      const projectDir = path.join(tempDir, 'my-repo');
      const subDir = path.join(projectDir, 'src', 'components');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      fs.mkdirSync(subDir, { recursive: true });

      const detected = findGitRoot(subDir);
      expect(detected).toBe(projectDir.replace(/\\/g, '/'));
    });

    test('findGitRoot returns null when no .git exists', () => {
      const subDir = path.join(tempDir, 'plain-folder', 'sub');
      fs.mkdirSync(subDir, { recursive: true });

      const detected = findGitRoot(subDir);
      expect(detected).toBeNull();
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

      const outsideConfig = path.join(tempDir, '.cmdbar.json');
      fs.writeFileSync(outsideConfig, JSON.stringify({ categories: [] }));

      expect(findWorkspaceConfigPath(subFolder)).toBeNull();
    });

    test('findWorkspaceConfig finds .cmdbar.json in current directory', async () => {
      const projectDir = path.join(tempDir, 'node-project');
      fs.mkdirSync(projectDir, { recursive: true });

      await createWorkspaceConfig(projectDir, 'node');

      const found = findWorkspaceConfig(projectDir);
      expect(found).not.toBeNull();
      expect(found.workspaceDir).toBe(projectDir.replace(/\\/g, '/'));
      expect(found.configPath).toBe(path.join(projectDir, '.cmdbar.json').replace(/\\/g, '/'));
    });

    test('findWorkspaceConfig finds .cmdbar/config.json from nested subdirectory', async () => {
      const projectDir = path.join(tempDir, 'cmdbar-dir-project');
      const nestedSub = path.join(projectDir, 'app', 'controllers');
      fs.mkdirSync(path.join(projectDir, '.cmdbar'), { recursive: true });
      fs.mkdirSync(nestedSub, { recursive: true });

      const configPath = path.join(projectDir, '.cmdbar', 'config.json');
      await saveConfig({ workspace_name: 'Nested Workspace', categories: [] }, configPath);

      const found = findWorkspaceConfig(nestedSub);
      expect(found).not.toBeNull();
      expect(found.workspaceDir).toBe(projectDir.replace(/\\/g, '/'));
      expect(found.configPath).toBe(configPath.replace(/\\/g, '/'));
    });

    test('findWorkspaceConfig returns null when no workspace config exists', () => {
      const emptyDir = path.join(tempDir, 'empty-project');
      fs.mkdirSync(emptyDir, { recursive: true });

      const found = findWorkspaceConfig(emptyDir);
      expect(found).toBeNull();
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

    test('createWorkspaceConfig initializes Node.js template', async () => {
      const targetDir = path.join(tempDir, 'node-app');
      fs.mkdirSync(targetDir, { recursive: true });

      const res = await createWorkspaceConfig(targetDir, 'node');
      expect(res.configPath).toBeTruthy();
      expect(fs.existsSync(res.configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(res.configPath, 'utf8'));
      expect(content.workspace_name).toBe('node-app');
      expect(content.categories).toHaveLength(1);
    });

    test('createWorkspaceConfig supports all built-in templates', async () => {
      const templates = ['python', 'rust', 'go', 'docker', 'generic'];
      for (const tmpl of templates) {
        const dir = path.join(tempDir, `tmpl-${tmpl}`);
        fs.mkdirSync(dir, { recursive: true });

        const res = await createWorkspaceConfig(dir, tmpl);
        expect(fs.existsSync(res.configPath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(res.configPath, 'utf8'));
        expect(content.categories.length).toBeGreaterThan(0);
      }
    });

    test('createWorkspaceConfig accepts custom configuration object', async () => {
      const targetDir = path.join(tempDir, 'custom-app');
      fs.mkdirSync(targetDir, { recursive: true });

      const custom = {
        name: 'Custom Service',
        categories: [
          { name: 'Deploy', commands: [{ name: 'K8s Apply', command: 'kubectl apply -f .' }] }
        ]
      };

      const res = await createWorkspaceConfig(targetDir, null, custom);
      const content = JSON.parse(fs.readFileSync(res.configPath, 'utf8'));
      expect(content.workspace_name).toBe('Custom Service');
      expect(content.categories[0].name).toBe('Deploy');
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

    test('getEffectiveConfig auto-detects and returns merged config from cwd', async () => {
      const globalConfigPath = path.join(tempDir, 'global-config.json');
      await saveConfig({ categories: [{ name: 'System', commands: [{ name: 'Uptime', command: 'uptime' }] }] }, globalConfigPath);

      const wsDir = path.join(tempDir, 'active-project');
      fs.mkdirSync(wsDir, { recursive: true });
      await createWorkspaceConfig(wsDir, 'python');

      const effective = await getEffectiveConfig(wsDir, globalConfigPath);
      expect(effective._workspace).toBeDefined();
      expect(effective._workspace.dir).toBe(wsDir.replace(/\\/g, '/'));
      expect(effective.categories.some(c => c.name === 'Python Commands' || c.name === 'Python Project')).toBe(true);
      expect(effective.categories.some(c => c.name === 'System')).toBe(true);
    });

    test('switchWorkspace smoothly switches to new working directory context', async () => {
      const globalConfigPath = path.join(tempDir, 'global-config.json');
      await saveConfig({ categories: [{ name: 'Global', commands: [] }] }, globalConfigPath);

      const dir1 = path.join(tempDir, 'project1');
      const dir2 = path.join(tempDir, 'project2');
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      await createWorkspaceConfig(dir1, 'rust');
      await createWorkspaceConfig(dir2, 'go');

      const config1 = await switchWorkspace(dir1, globalConfigPath);
      expect(config1.categories.some(c => c.name === 'Rust Project' || c.name === 'Cargo Commands')).toBe(true);

      const config2 = await switchWorkspace(dir2, globalConfigPath);
      expect(config2.categories.some(c => c.name === 'Go Project' || c.name === 'Go Commands')).toBe(true);
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
