import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  findGitRoot,
  findWorkspaceConfig,
  createWorkspaceConfig,
  mergeConfigs,
  getEffectiveConfig,
  switchWorkspace,
  PROJECT_TEMPLATES,
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

  describe('Git Root Detection', () => {
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

  describe('Workspace Config Auto-Detection', () => {
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

  describe('Project Templates Initialization', () => {
    test('createWorkspaceConfig initializes Node.js template', async () => {
      const targetDir = path.join(tempDir, 'node-app');
      fs.mkdirSync(targetDir, { recursive: true });

      const res = await createWorkspaceConfig(targetDir, 'node');
      expect(res.configPath).toBeTruthy();
      expect(fs.existsSync(res.configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(res.configPath, 'utf8'));
      expect(content.workspace_name).toBe('node-app');
      expect(content.categories).toHaveLength(1);
      expect(content.categories[0].name).toBe('Node.js');
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

  describe('Configuration Merging and Smooth Switching', () => {
    test('mergeConfigs smoothly combines global and workspace configs', () => {
      const globalCfg = {
        categories: [
          { name: 'Global Tools', commands: [{ name: 'HTOP', command: 'htop' }] }
        ]
      };
      const wsCfg = {
        workspace_name: 'Frontend App',
        categories: [
          { name: 'Node.js', commands: [{ name: 'NPM Test', command: 'npm test' }] }
        ]
      };

      const merged = mergeConfigs(globalCfg, wsCfg);
      expect(merged._workspace.active).toBe(true);
      expect(merged._workspace.name).toBe('Frontend App');
      expect(merged.categories).toHaveLength(2);
      expect(merged.categories[0].name).toBe('Node.js');
      expect(merged.categories[0].workspace).toBe(true);
      expect(merged.categories[1].name).toBe('Global Tools');
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
      expect(effective.categories.some(c => c.name === 'Python')).toBe(true);
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
      expect(config1.categories.some(c => c.name === 'Rust')).toBe(true);

      const config2 = await switchWorkspace(dir2, globalConfigPath);
      expect(config2.categories.some(c => c.name === 'Go')).toBe(true);
    });
  });
});
